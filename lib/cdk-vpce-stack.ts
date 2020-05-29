import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import { CfnOutput } from '@aws-cdk/core';

export class CdkVpceStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // === Part 1: Service Producer VPC and ECS Service ===

    // VPC with 3 private subnets
    const vpc = new ec2.Vpc(this, 'Producer', {
      natGateways: 1,
      cidr: '10.40.0.0/16',
      maxAzs: 3,
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.PRIVATE,
          name: 'Application',
          cidrMask: 24,
        },
        {
          subnetType: ec2.SubnetType.PUBLIC,
          name: 'Ingress',
          cidrMask: 24,
        }
      ]
    });

    // ECS cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {vpc})

    // ECS container, task definitions
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MyService');
    const defaultContainer = taskDefinition.addContainer('Default', {
      image: ecs.ContainerImage.fromRegistry("nginx"),
      memoryLimitMiB: 512
    });

    defaultContainer.addPortMappings({containerPort: 80, hostPort: 80});

    const ecsServiceSg = new ec2.SecurityGroup(this, 'EcsIngressEgress', {
      vpc: vpc,
      allowAllOutbound: true
    });

    // Allow ingress on TCP/80
    ecsServiceSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    // ECS service
    const svc = new ecs.FargateService(this, 'service', {
      cluster,
      taskDefinition,
      desiredCount: 3,
      securityGroup: ecsServiceSg,
      vpcSubnets: {subnetType: ec2.SubnetType.PRIVATE}
    });

    // Public NLB (for testing)
    const publicLb = new elbv2.NetworkLoadBalancer(this, 'PublicLB', {
      vpc,
      internetFacing: true,
      vpcSubnets: {subnetType: ec2.SubnetType.PUBLIC},
    });

    const publicTgt = new elbv2.NetworkTargetGroup(this, 'public', {
      vpc, 
      port: 80, 
      targetType: elbv2.TargetType.IP,
    });
    svc.attachToNetworkTargetGroup(publicTgt);

    const publicListener = publicLb.addListener('service', {
      port: 80,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [publicTgt]
    });
    
    // Internal NLB (used for endpoint service)
    const internalLb = new elbv2.NetworkLoadBalancer(this, 'InternalLB', {
      vpc,
      internetFacing: false,
      vpcSubnets: {subnetType: ec2.SubnetType.PRIVATE}
    });

    const internalTgt = new elbv2.NetworkTargetGroup(this, 'private', {
      vpc,
      port: 80, 
      targetType: elbv2.TargetType.IP,
    });
    svc.attachToNetworkTargetGroup(internalTgt);

    const internalListener = internalLb.addListener('service', {
      port: 80,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [internalTgt]
    });

    // Endpoint service
    // The console allows us to register a private DNS name for the service but it requires domain verification
    // There doesn't seem to be a way to do this in CDK/CloudFormation though
    const vpce = new ec2.VpcEndpointService(this, 'StupidService', {
      vpcEndpointServiceLoadBalancers: [internalLb],
      vpcEndpointServiceName: 'myservice.yodo.io',
      acceptanceRequired: false,
      whitelistedPrincipals: [new iam.AccountPrincipal('468871832330')],
    });

    // Outputs
    new CfnOutput(this, 'PublicUrl', {
      value: `http://${publicLb.loadBalancerDnsName}`,
      exportName: 'PublicLbDnsName'
    });

    new CfnOutput(this, 'InternalUrl', {
      value: `http://${internalLb.loadBalancerDnsName}`,
      exportName: 'InternalLbDnsName'
    });
  }
}
