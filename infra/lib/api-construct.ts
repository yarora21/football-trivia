import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';

interface ApiConstructProps {
  wsConnectFn: lambda.Function;
  wsDisconnectFn: lambda.Function;
  wsDefaultFn: lambda.Function;
  gameBroadcastFn: lambda.Function;
  table: dynamodb.Table;
  stateMachine: sfn.StateMachine;
}

export class ApiConstruct extends Construct {
  public readonly webSocketApi: apigwv2.WebSocketApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    this.webSocketApi = new apigwv2.WebSocketApi(this, 'TriviaWebSocketApi', {
      apiName: 'trivia-websocket',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          props.wsConnectFn,
        ),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          props.wsDisconnectFn,
        ),
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          props.wsDefaultFn,
        ),
      },
    });

    const stage = new apigwv2.WebSocketStage(this, 'ProdStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    new cdk.CfnOutput(cdk.Stack.of(this), 'WebSocketUrl', {
      value: stage.url,
      description: 'Connect with: wscat -c "<url>?room=TEST&role=player&name=Alex"',
    });

    // Give broadcast Lambda the WebSocket management endpoint and permission
    const wsManagementUrl = `https://${this.webSocketApi.apiId}.execute-api.${cdk.Stack.of(this).region}.amazonaws.com/${stage.stageName}`;
    props.gameBroadcastFn.addEnvironment('WS_ENDPOINT', wsManagementUrl);
    this.webSocketApi.grantManageConnections(props.gameBroadcastFn);

    // ws_default also needs manage connections to send responses back
    this.webSocketApi.grantManageConnections(props.wsDefaultFn);

    // HTTP API for room management
    const httpApi = new apigwv2.HttpApi(this, 'TriviaHttpApi', {
      apiName: 'trivia-http',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.POST],
        allowHeaders: ['Content-Type'],
      },
    });

    const httpCreateRoomFn = new lambda.Function(this, 'HttpCreateRoomFunction', {
      functionName: 'trivia-http-create-room',
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset('../lambdas/http_create_room'),
      handler: 'handler.handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: props.table.tableName,
        STATE_MACHINE_ARN: props.stateMachine.stateMachineArn,
      },
    });
    props.table.grantWriteData(httpCreateRoomFn);
    props.stateMachine.grantStartExecution(httpCreateRoomFn);

    httpApi.addRoutes({
      path: '/rooms',
      methods: [HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        'CreateRoomIntegration',
        httpCreateRoomFn,
      ),
    });

    new cdk.CfnOutput(cdk.Stack.of(this), 'HttpApiUrl', {
      value: httpApi.url!,
      description: 'HTTP API base URL — POST /rooms to create a room',
    });
  }
}
