#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TriviaStack } from '../lib/trivia-stack';

const app = new cdk.App();

new TriviaStack(app, 'FootballTrivia', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
