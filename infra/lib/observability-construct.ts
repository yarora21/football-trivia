import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

interface ObservabilityConstructProps {
  lambdaFunctions: lambda.Function[];
  gameCriticalFunctions: lambda.Function[];
  table: dynamodb.Table;
  advanceQueue: sqs.Queue;
  deadLetterQueue: sqs.Queue;
  stateMachine: sfn.StateMachine;
  alertEmail?: string;
}

export class ObservabilityConstruct extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityConstructProps) {
    super(scope, id);

    // ── SNS Alert Topic ──
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'trivia-alerts',
      displayName: 'Trivia Game Alerts',
    });

    const alertEmail = props.alertEmail || this.node.tryGetContext('alertEmail');
    if (alertEmail) {
      this.alertTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(alertEmail),
      );
    }

    const alarmAction = new cloudwatchActions.SnsAction(this.alertTopic);

    // ── Alarms ──

    // 1. Lambda errors — CloudWatch limits math expressions to 10 metrics,
    //    so we create one alarm per function and combine with a CompositeAlarm
    const perFunctionAlarms = props.lambdaFunctions.map((fn, i) =>
      fn.metricErrors({ period: cdk.Duration.minutes(5) })
        .createAlarm(this, `LambdaErrorAlarm${i}`, {
          alarmName: `trivia-lambda-errors-${fn.functionName}`,
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }),
    );
    const lambdaErrorAlarm = new cloudwatch.CompositeAlarm(this, 'LambdaErrorComposite', {
      compositeAlarmName: 'trivia-lambda-errors',
      alarmRule: cloudwatch.AlarmRule.anyOf(...perFunctionAlarms),
    });
    lambdaErrorAlarm.addAlarmAction(alarmAction);

    // 2. Step Function failures
    const sfnFailAlarm = props.stateMachine.metricFailed({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'SfnFailAlarm', {
      alarmName: 'trivia-sfn-failures',
      alarmDescription: 'Step Function execution failed',
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    sfnFailAlarm.addAlarmAction(alarmAction);

    // 3. DynamoDB throttles
    const readThrottles = props.table.metricThrottledRequestsForOperations({
      operations: [dynamodb.Operation.GET_ITEM, dynamodb.Operation.QUERY],
      period: cdk.Duration.minutes(5),
    });
    const writeThrottles = props.table.metricThrottledRequestsForOperations({
      operations: [dynamodb.Operation.PUT_ITEM, dynamodb.Operation.UPDATE_ITEM],
      period: cdk.Duration.minutes(5),
    });
    const throttleAlarm = new cloudwatch.MathExpression({
      expression: 'reads + writes',
      usingMetrics: { reads: readThrottles, writes: writeThrottles },
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'DynamoThrottleAlarm', {
      alarmName: 'trivia-dynamo-throttles',
      alarmDescription: 'DynamoDB throttling detected',
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    throttleAlarm.addAlarmAction(alarmAction);

    // 4. SQS message age — messages stuck in queue too long
    const messageAgeAlarm = props.advanceQueue.metricApproximateAgeOfOldestMessage({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'SqsMessageAgeAlarm', {
      alarmName: 'trivia-sqs-message-age',
      alarmDescription: 'SQS messages stuck for over 2 minutes',
      threshold: 120,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    messageAgeAlarm.addAlarmAction(alarmAction);

    // 5. DLQ has messages — poison messages detected
    const dlqAlarm = props.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(5),
    }).createAlarm(this, 'DlqAlarm', {
      alarmName: 'trivia-dlq-messages',
      alarmDescription: 'Dead letter queue has messages — investigate failed SQS processing',
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(alarmAction);

    // 6. High latency on ws_default (the hot path)
    const wsDefaultFn = props.gameCriticalFunctions[0]; // ws_default
    if (wsDefaultFn) {
      const latencyAlarm = wsDefaultFn.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'p95',
      }).createAlarm(this, 'WsDefaultLatencyAlarm', {
        alarmName: 'trivia-ws-default-p95-latency',
        alarmDescription: 'ws_default P95 latency exceeds 5 seconds',
        threshold: 5000,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      latencyAlarm.addAlarmAction(alarmAction);
    }

    // ── Dashboard ──
    this.dashboard = new cloudwatch.Dashboard(this, 'TriviaGameDashboard', {
      dashboardName: 'TriviaGameDashboard',
    });

    // Lambda Errors
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        width: 12,
        left: props.lambdaFunctions.map(fn => fn.metricErrors()),
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (P95) — Game Critical',
        width: 12,
        left: props.gameCriticalFunctions.map(fn =>
          fn.metricDuration({ statistic: 'p95' }),
        ),
      }),
    );

    // Lambda Invocations
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        width: 24,
        left: props.lambdaFunctions.map(fn => fn.metricInvocations()),
        stacked: true,
      }),
    );

    // DynamoDB
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Consumed Capacity',
        width: 12,
        left: [
          props.table.metricConsumedReadCapacityUnits(),
          props.table.metricConsumedWriteCapacityUnits(),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Throttles',
        width: 12,
        left: [readThrottles, writeThrottles],
      }),
    );

    // SQS
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'SQS Advance Queue',
        width: 12,
        left: [
          props.advanceQueue.metricApproximateNumberOfMessagesVisible(),
          props.advanceQueue.metricApproximateAgeOfOldestMessage(),
          props.advanceQueue.metricNumberOfMessagesSent(),
        ],
      }),
      // Step Functions
      new cloudwatch.GraphWidget({
        title: 'Step Functions — Room Creation',
        width: 12,
        left: [
          props.stateMachine.metricStarted(),
          props.stateMachine.metricSucceeded(),
          props.stateMachine.metricFailed(),
        ],
      }),
    );

    // API Gateway metrics (using custom metric since we need the API name)
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DLQ Messages',
        width: 12,
        left: [
          props.deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
        ],
      }),
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarm Status',
        width: 12,
        alarms: [
          lambdaErrorAlarm,
          sfnFailAlarm,
          throttleAlarm,
        ],
      }),
    );
  }
}
