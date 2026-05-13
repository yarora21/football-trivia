import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';

export class DataConstruct extends Construct {
  public readonly table: dynamodb.Table;
  public readonly vpc: ec2.Vpc;
  public readonly redisSecurityGroup: ec2.SecurityGroup;
  public readonly redisEndpoint: string;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'TriviaTable', {
      tableName: 'trivia',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // VPC for Redis-touching Lambdas
    this.vpc = new ec2.Vpc(this, 'TriviaVpc', {
      maxAzs: 2,
      natGateways: 0, // no NAT — we use VPC endpoints instead
      subnetConfiguration: [
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Free gateway endpoint for DynamoDB
    this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // Interface endpoints for API Gateway (post_to_connection) and SQS
    this.vpc.addInterfaceEndpoint('ExecuteApiEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.APIGATEWAY,
    });

    this.vpc.addInterfaceEndpoint('SqsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SQS,
    });

    this.vpc.addInterfaceEndpoint('LambdaEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
    });

    // Security group for Lambdas that need Redis access
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'Security group for VPC Lambdas',
    });

    // Security group for Redis
    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc: this.vpc,
      description: 'Security group for ElastiCache Redis',
    });
    this.redisSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Lambda to connect to Redis',
    );

    // ElastiCache Serverless Redis
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnets for ElastiCache Redis',
      subnetIds: this.vpc.isolatedSubnets.map(s => s.subnetId),
      cacheSubnetGroupName: 'trivia-redis-subnets',
    });

    const redis = new elasticache.CfnServerlessCache(this, 'TriviaRedis', {
      engine: 'redis',
      serverlessCacheName: 'trivia-redis',
      securityGroupIds: [this.redisSecurityGroup.securityGroupId],
      subnetIds: this.vpc.isolatedSubnets.map(s => s.subnetId),
    });
    redis.addDependency(redisSubnetGroup);

    this.redisEndpoint = redis.attrEndpointAddress;
  }
}
