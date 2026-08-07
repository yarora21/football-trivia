import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

interface ComputeConstructProps {
  table: dynamodb.Table;
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  redisEndpoint: string;
}

export class ComputeConstruct extends Construct {
  public readonly wsConnectFn: lambda.Function;
  public readonly wsDisconnectFn: lambda.Function;
  public readonly wsDefaultFn: lambda.Function;
  public readonly gameScoreAnswerFn: lambda.Function;
  public readonly gameBroadcastFn: lambda.Function;
  public readonly gameAdvanceRoundFn: lambda.Function;
  public readonly sfFetchDataFn: lambda.Function;
  public readonly sfGenerateQuestionsFn: lambda.Function;
  public readonly sfValidateQuestionsFn: lambda.Function;
  public readonly sfPersistQuestionsFn: lambda.Function;
  public readonly sfMarkFailedFn: lambda.Function;
  public readonly advanceQueue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly xrayLayer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);

    // X-Ray SDK Lambda Layer — shared by all Lambdas that make downstream calls
    // Built locally: cd lambdas/layers/xray && pip install -r requirements.txt -t python/
    this.xrayLayer = new lambda.LayerVersion(this, 'XRayLayer', {
      code: lambda.Code.fromAsset('../lambdas/layers/xray'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'AWS X-Ray SDK for Python',
    });

    this.wsConnectFn = new lambda.Function(this, 'WsConnectFunction', {
      functionName: 'trivia-ws-connect',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/ws_connect'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
      environment: {
        TABLE_NAME: props.table.tableName,
      },
    });
    props.table.grantWriteData(this.wsConnectFn);

    this.wsDisconnectFn = new lambda.Function(this, 'WsDisconnectFunction', {
      functionName: 'trivia-ws-disconnect',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/ws_disconnect'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
      environment: {
        TABLE_NAME: props.table.tableName,
      },
    });
    props.table.grantReadWriteData(this.wsDisconnectFn);

    this.wsDefaultFn = new lambda.Function(this, 'WsDefaultFunction', {
      functionName: 'trivia-ws-default',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/ws_default'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
    });

    this.sfFetchDataFn = new lambda.Function(this, 'SfFetchDataFunction', {
      functionName: 'trivia-sf-fetch-data',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/sf_fetch_data'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
    });

    this.sfGenerateQuestionsFn = new lambda.Function(this, 'SfGenerateQuestionsFunction', {
      functionName: 'trivia-sf-generate-questions',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/sf_generate_questions'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
    });
    this.sfGenerateQuestionsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0',
      ],
    }));

    this.sfValidateQuestionsFn = new lambda.Function(this, 'SfValidateQuestionsFunction', {
      functionName: 'trivia-sf-validate-questions',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/sf_validate_questions'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
    });

    this.sfPersistQuestionsFn = new lambda.Function(this, 'SfPersistQuestionsFunction', {
      functionName: 'trivia-sf-persist-questions',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/sf_persist_questions'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
      environment: {
        TABLE_NAME: props.table.tableName,
      },
    });
    props.table.grantWriteData(this.sfPersistQuestionsFn);

    this.sfMarkFailedFn = new lambda.Function(this, 'SfMarkFailedFunction', {
      functionName: 'trivia-sf-mark-failed',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/sf_mark_failed'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
      environment: {
        TABLE_NAME: props.table.tableName,
      },
    });
    props.table.grantWriteData(this.sfMarkFailedFn);

    // VPC Lambdas — these need Redis access
    const vpcLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_12,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.lambdaSecurityGroup],
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
      environment: {
        TABLE_NAME: props.table.tableName,
        REDIS_HOST: props.redisEndpoint,
      },
    };

    this.gameScoreAnswerFn = new lambda.Function(this, 'GameScoreAnswerFunction', {
      ...vpcLambdaProps,
      functionName: 'trivia-game-score-answer',
      code: lambda.Code.fromAsset('../lambdas/game_score_answer'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(10),
    });
    props.table.grantReadWriteData(this.gameScoreAnswerFn);

    this.gameBroadcastFn = new lambda.Function(this, 'GameBroadcastFunction', {
      functionName: 'trivia-game-broadcast',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/game_broadcast'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      layers: [this.xrayLayer],
      environment: {
        TABLE_NAME: props.table.tableName,
      },
    });
    props.table.grantReadWriteData(this.gameBroadcastFn);

    // sf_persist_questions pushes room.ready via the broadcast Lambda once
    // questions are stored, so the host page updates without a manual refresh.
    this.sfPersistQuestionsFn.addEnvironment('BROADCAST_FN_NAME', this.gameBroadcastFn.functionName);
    this.gameBroadcastFn.grantInvoke(this.sfPersistQuestionsFn);

    // DLQ for messages that fail processing 3 times
    this.deadLetterQueue = new sqs.Queue(this, 'AdvanceDLQ', {
      queueName: 'trivia-advance-round-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS delay queue for auto-advancing questions after 15s
    this.advanceQueue = new sqs.Queue(this, 'AdvanceQueue', {
      queueName: 'trivia-advance-round',
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    this.gameAdvanceRoundFn = new lambda.Function(this, 'GameAdvanceRoundFunction', {
      ...vpcLambdaProps,
      functionName: 'trivia-game-advance-round',
      code: lambda.Code.fromAsset('../lambdas/game_advance_round'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...vpcLambdaProps.environment,
        QUEUE_URL: this.advanceQueue.queueUrl,
        BROADCAST_FN_NAME: this.gameBroadcastFn.functionName,
      },
    });
    props.table.grantReadWriteData(this.gameAdvanceRoundFn);
    this.gameBroadcastFn.grantInvoke(this.gameAdvanceRoundFn);
    this.advanceQueue.grantSendMessages(this.gameAdvanceRoundFn);
    this.gameAdvanceRoundFn.addEventSource(
      new lambdaEventSources.SqsEventSource(this.advanceQueue),
    );

    // ws_default needs DynamoDB, SQS, and permission to invoke score + broadcast Lambdas
    this.wsDefaultFn.addEnvironment('TABLE_NAME', props.table.tableName);
    this.wsDefaultFn.addEnvironment('QUEUE_URL', this.advanceQueue.queueUrl);
    this.wsDefaultFn.addEnvironment('SCORE_FN_NAME', this.gameScoreAnswerFn.functionName);
    this.wsDefaultFn.addEnvironment('BROADCAST_FN_NAME', this.gameBroadcastFn.functionName);
    props.table.grantReadWriteData(this.wsDefaultFn);
    this.advanceQueue.grantSendMessages(this.wsDefaultFn);
    this.gameScoreAnswerFn.grantInvoke(this.wsDefaultFn);
    this.gameBroadcastFn.grantInvoke(this.wsDefaultFn);
  }
}
