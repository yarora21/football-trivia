import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DataConstruct } from './data-stack';
import { ComputeConstruct } from './compute-stack';
import { ApiConstruct } from './api-stack';
import { OrchestrationConstruct } from './orchestration-stack';

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
    });
  }
}
