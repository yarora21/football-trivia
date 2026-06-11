import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DataConstruct } from './data-construct';
import { ComputeConstruct } from './compute-construct';
import { ApiConstruct } from './api-construct';
import { OrchestrationConstruct } from './orchestration-construct';
import { ObservabilityConstruct } from './observability-construct';

export class TriviaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const data = new DataConstruct(this, 'Data');

    const compute = new ComputeConstruct(this, 'Compute', {
      table: data.table,
      vpc: data.vpc,
      lambdaSecurityGroup: data.lambdaSecurityGroup,
      redisEndpoint: data.redisEndpoint,
    });

    const orchestration = new OrchestrationConstruct(this, 'Orchestration', {
      sfFetchDataFn: compute.sfFetchDataFn,
      sfGenerateQuestionsFn: compute.sfGenerateQuestionsFn,
      sfValidateQuestionsFn: compute.sfValidateQuestionsFn,
      sfPersistQuestionsFn: compute.sfPersistQuestionsFn,
      sfMarkFailedFn: compute.sfMarkFailedFn,
    });

    new ApiConstruct(this, 'Api', {
      wsConnectFn: compute.wsConnectFn,
      wsDisconnectFn: compute.wsDisconnectFn,
      wsDefaultFn: compute.wsDefaultFn,
      gameBroadcastFn: compute.gameBroadcastFn,
      table: data.table,
      stateMachine: orchestration.stateMachine,
      xrayLayer: compute.xrayLayer,
    });

    new ObservabilityConstruct(this, 'Observability', {
      lambdaFunctions: [
        compute.wsConnectFn,
        compute.wsDisconnectFn,
        compute.wsDefaultFn,
        compute.gameScoreAnswerFn,
        compute.gameBroadcastFn,
        compute.gameAdvanceRoundFn,
        compute.sfFetchDataFn,
        compute.sfGenerateQuestionsFn,
        compute.sfValidateQuestionsFn,
        compute.sfPersistQuestionsFn,
        compute.sfMarkFailedFn,
      ],
      gameCriticalFunctions: [
        compute.wsDefaultFn,
        compute.gameScoreAnswerFn,
        compute.gameAdvanceRoundFn,
        compute.gameBroadcastFn,
      ],
      table: data.table,
      advanceQueue: compute.advanceQueue,
      deadLetterQueue: compute.deadLetterQueue,
      stateMachine: orchestration.stateMachine,
    });
  }
}
