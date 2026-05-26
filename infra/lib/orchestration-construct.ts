import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

interface OrchestrationConstructProps {
  sfFetchDataFn: lambda.Function;
  sfGenerateQuestionsFn: lambda.Function;
  sfValidateQuestionsFn: lambda.Function;
  sfPersistQuestionsFn: lambda.Function;
  sfMarkFailedFn: lambda.Function;
}

export class OrchestrationConstruct extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: OrchestrationConstructProps) {
    super(scope, id);

    const markFailed = new tasks.LambdaInvoke(this, 'MarkRoomFailed', {
      lambdaFunction: props.sfMarkFailedFn,
      outputPath: '$.Payload',
    });

    const persistQuestions = new tasks.LambdaInvoke(this, 'PersistQuestions', {
      lambdaFunction: props.sfPersistQuestionsFn,
      outputPath: '$.Payload',
    });
    persistQuestions.next(new sfn.Succeed(this, 'Done'));

    const generateQuestions = new tasks.LambdaInvoke(this, 'GenerateQuestions', {
      lambdaFunction: props.sfGenerateQuestionsFn,
      outputPath: '$.Payload',
      taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(60)),
    });
    generateQuestions.addRetry({
      errors: ['States.TaskFailed'],
      maxAttempts: 1,
    });
    generateQuestions.addCatch(markFailed, { errors: ['States.ALL'] });

    const validateQuestions = new tasks.LambdaInvoke(this, 'ValidateQuestions', {
      lambdaFunction: props.sfValidateQuestionsFn,
      outputPath: '$.Payload',
    });
    validateQuestions.addCatch(generateQuestions, {
      errors: ['QuestionsFailedValidation'],
      resultPath: '$.validationError',
    });
    validateQuestions.next(persistQuestions);

    generateQuestions.next(validateQuestions);

    const fetchData = new tasks.LambdaInvoke(this, 'FetchFootballData', {
      lambdaFunction: props.sfFetchDataFn,
      outputPath: '$.Payload',
    });
    fetchData.addRetry({
      errors: ['States.TaskFailed'],
      maxAttempts: 2,
      backoffRate: 2,
    });
    fetchData.addCatch(markFailed, { errors: ['States.ALL'] });
    fetchData.next(generateQuestions);

    this.stateMachine = new sfn.StateMachine(this, 'RoomCreationPipeline', {
      stateMachineName: 'RoomCreationPipeline',
      definitionBody: sfn.DefinitionBody.fromChainable(fetchData),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      tracingEnabled: true,
    });
  }
}
