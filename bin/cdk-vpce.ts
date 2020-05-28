#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkVpceStack } from '../lib/cdk-vpce-stack';

const app = new cdk.App();
new CdkVpceStack(app, 'CdkVpceStack');
