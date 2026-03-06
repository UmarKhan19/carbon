# AWS GovCloud Resource Inventory

**Account ID:** 453096467244
**Region:** us-gov-east-1
**Date:** 2026-03-06

This document lists all active AWS resources in the GovCloud account. The goal is to replicate this environment in a new AWS account with equivalent permissions and resources.

---

## AWS Services Required

The following AWS services are actively used and need permissions in the new account:

- **EC2** (instances, security groups, EBS, Elastic IPs, VPC, subnets, route tables, internet gateways, VPC endpoints, network ACLs)
- **ECS** (clusters, services, task definitions) with **Fargate** launch type
- **ECR** (container image repositories)
- **Elastic Load Balancing** (Application Load Balancers, target groups)
- **S3** (buckets)
- **RDS** (subnet groups -- database runs on EC2 via Supabase, not RDS directly)
- **IAM** (users, roles, policies)
- **ACM** (SSL/TLS certificates)
- **Route 53** (private hosted zones)
- **Lambda** (functions)
- **Secrets Manager** (secrets for application configuration)
- **Systems Manager** (SSM parameters)
- **CloudWatch Logs** (log groups)
- **CloudFormation** (infrastructure stacks)
- **KMS** (encryption keys)

---

## S3 Buckets

| Bucket Name | Created |
|---|---|
| carbon-supabase-dev | 2025-12-15 |
| carbon-supabase-prod | 2025-12-15 |
| sst-state-habuuwhfmaww | 2025-12-15 |
| sst-state-oxnrmaxcrswt | 2025-09-25 |

---

## EC2 Instances

| Instance ID | Name | Type | State | AZ | Private IP | Public IP |
|---|---|---|---|---|---|---|
| i-0c08bda558949f611 | supabase-carbon-encrypted | m5.xlarge | running | us-gov-east-1a | 10.0.7.157 | 18.253.135.201 |

---

## VPCs

| VPC ID | Name | CIDR | Default |
|---|---|---|---|
| vpc-0577e54eb7bafc84c | carbon-prod-CarbonVpc2 VPC | 10.0.0.0/16 | No |
| vpc-0eefe4d5faf1e56e5 | SupabaseVPC/VPC | 10.0.0.0/16 | No |
| vpc-01df94682daccf2f0 | carbon-supabase-vpc | 10.0.0.0/16 | No |
| vpc-0d3f47b17f0c79920 | carbon-prod-CarbonVpc2 VPC | 10.0.0.0/16 | No |
| vpc-050e64dd5ada79913 | (default) | 172.31.0.0/16 | Yes |

---

## Subnets

| Subnet ID | Name | VPC | CIDR | AZ | Public |
|---|---|---|---|---|---|
| subnet-0384bed104ae58adc | carbon-supabase-subnet-public1 | vpc-01df94682daccf2f0 | 10.0.0.0/20 | us-gov-east-1a | Yes |
| subnet-0792a4b09cbe2cbd7 | carbon-supabase-subnet-public2 | vpc-01df94682daccf2f0 | 10.0.16.0/20 | us-gov-east-1b | No |
| subnet-0a901305d55c9d41d | carbon-supabase-subnet-private1 | vpc-01df94682daccf2f0 | 10.0.128.0/20 | us-gov-east-1a | No |
| subnet-0ba7b81ad3be2a12f | carbon-supabase-subnet-private2 | vpc-01df94682daccf2f0 | 10.0.144.0/20 | us-gov-east-1b | No |
| subnet-003098a4e24f0ea86 | RDS-Pvt-subnet-1 | vpc-01df94682daccf2f0 | 10.0.32.0/25 | us-gov-east-1a | No |
| subnet-02fa67997bfb766d4 | RDS-Pvt-subnet-2 | vpc-01df94682daccf2f0 | 10.0.32.128/25 | us-gov-east-1c | No |
| subnet-0270118bf328dd7fa | RDS-Pvt-subnet-3 | vpc-01df94682daccf2f0 | 10.0.33.0/25 | us-gov-east-1b | No |
| subnet-0fe5fdc9bb7cd3f7c | carbon-prod-CarbonVpc2PublicSubnet1 | vpc-0577e54eb7bafc84c | 10.0.0.0/22 | us-gov-east-1a | Yes |
| subnet-03f104db5163b2e09 | carbon-prod-CarbonVpc2PublicSubnet2 | vpc-0577e54eb7bafc84c | 10.0.8.0/22 | us-gov-east-1b | Yes |
| subnet-09e28764980ccea2e | carbon-prod-CarbonVpc2PrivateSubnet1 | vpc-0577e54eb7bafc84c | 10.0.4.0/22 | us-gov-east-1a | No |
| subnet-09a8a8e5955d5632b | carbon-prod-CarbonVpc2PrivateSubnet2 | vpc-0577e54eb7bafc84c | 10.0.12.0/22 | us-gov-east-1b | No |
| subnet-0d8573ab7d056bc7e | carbon-prod-CarbonVpc2PublicSubnet1 | vpc-0d3f47b17f0c79920 | 10.0.0.0/22 | us-gov-east-1a | Yes |
| subnet-0fe68a61e192d1658 | carbon-prod-CarbonVpc2PublicSubnet2 | vpc-0d3f47b17f0c79920 | 10.0.8.0/22 | us-gov-east-1b | Yes |
| subnet-0b2f9993504f36aea | carbon-prod-CarbonVpc2PrivateSubnet1 | vpc-0d3f47b17f0c79920 | 10.0.4.0/22 | us-gov-east-1a | No |
| subnet-049fc0beda1e4ad51 | carbon-prod-CarbonVpc2PrivateSubnet2 | vpc-0d3f47b17f0c79920 | 10.0.12.0/22 | us-gov-east-1b | No |

---

## Security Groups

| Group ID | Name | VPC | Description |
|---|---|---|---|
| sg-0221990c3706cf793 | supabase | vpc-01df94682daccf2f0 | Allow access to supabase studio and service |
| sg-0ec5ba590fd65187c | frontend | vpc-01df94682daccf2f0 | launch-wizard-1 created 2025-09-24 |
| sg-004e7d31f078b8e85 | CarbonMESServiceLoadBalancerSecurityGroup | vpc-0577e54eb7bafc84c | Managed by SST |
| sg-033bc6e1bc76e8bfa | CarbonERPServiceLoadBalancerSecurityGroup | vpc-0577e54eb7bafc84c | Managed by SST |
| sg-07faa9b5da124c20e | CarbonERPServiceLoadBalancerSecurityGroup | vpc-0d3f47b17f0c79920 | Managed by SST |
| sg-0687ba81f95871576 | CarbonMESServiceLoadBalancerSecurityGroup | vpc-0d3f47b17f0c79920 | Managed by SST |
| sg-0adac64852b4386b3 | rds-ec2-1 | vpc-050e64dd5ada79913 | RDS-to-EC2 connectivity |
| sg-0a7e60db2f7a11987 | rds-ec2-2 | vpc-050e64dd5ada79913 | RDS-to-EC2 connectivity |
| sg-04d982f71b430fe23 | rds-ec2-3 | vpc-01df94682daccf2f0 | RDS-to-EC2 connectivity |
| sg-0d5e1956b8d41eede | rds-ec2-4 | vpc-01df94682daccf2f0 | RDS-to-EC2 connectivity |
| sg-0043f66c62de8722e | rds-ec2-5 | vpc-01df94682daccf2f0 | RDS-to-EC2 connectivity |
| sg-0baa17f417783abe3 | ec2-rds-1 | vpc-050e64dd5ada79913 | EC2-to-RDS connectivity |
| sg-0362581cc824d49f9 | ec2-rds-2 | vpc-050e64dd5ada79913 | EC2-to-RDS connectivity |
| sg-0a9c48c0fd2e3c569 | ec2-rds-3 | vpc-01df94682daccf2f0 | EC2-to-RDS connectivity |
| sg-0e92ed6c4235d9b28 | ec2-rds-4 | vpc-01df94682daccf2f0 | EC2-to-RDS connectivity |
| sg-0cba728c40deaabc5 | ec2-rds-5 | vpc-01df94682daccf2f0 | EC2-to-RDS connectivity |
| sg-006cb36d29280362b | default | vpc-01df94682daccf2f0 | default VPC security group |
| sg-05b865cf93581bb62 | default | vpc-050e64dd5ada79913 | default VPC security group |
| sg-00ab5d6122491360e | default | vpc-0eefe4d5faf1e56e5 | default VPC security group |
| sg-05b453f1616b0afd3 | default | vpc-0577e54eb7bafc84c | default VPC security group |
| sg-0d4ef2ca9a8ea859f | default | vpc-0d3f47b17f0c79920 | default VPC security group |

---

## Internet Gateways

| IGW ID | Name | Attached VPC |
|---|---|---|
| igw-01bdaccc1cbf7d82c | carbon-supabase-igw | vpc-01df94682daccf2f0 |
| igw-061e4e249932064db | carbon-prod-CarbonVpc2InternetGateway | vpc-0577e54eb7bafc84c |
| igw-0acd96f20df89bcd2 | carbon-prod-CarbonVpc2InternetGateway | vpc-0d3f47b17f0c79920 |
| igw-0ae3a0750021bb301 | SupabaseVPC/VPC | vpc-0eefe4d5faf1e56e5 |
| igw-08670deca5218fa88 | (default) | vpc-050e64dd5ada79913 |

---

## NAT Gateways

None.

---

## VPC Endpoints

| Endpoint ID | VPC | Service | Type |
|---|---|---|---|
| vpce-07eceb11b4d7ee59e | vpc-01df94682daccf2f0 | com.amazonaws.us-gov-east-1.s3 | Gateway |

---

## Elastic IPs

| Public IP | Allocation ID | Associated Instance | Name |
|---|---|---|---|
| 16.64.114.232 | eipalloc-06c25c98573df748d | -- | SupabaseVPC/VPC/PublicSubnet1 |
| 16.64.125.1 | eipalloc-0e013635d63ca51ee | -- | -- |
| 18.253.201.31 | eipalloc-02823918ce016ec36 | -- | -- |
| 182.30.128.126 | eipalloc-0a4d9d4ed8879f30f | -- | -- |
| 182.30.60.107 | eipalloc-0decbba1ac9ab5ba9 | -- | -- |

---

## EBS Volumes

| Volume ID | Size (GB) | Type | State | AZ | Encrypted |
|---|---|---|---|---|---|
| vol-0af94df135aaebb4e | 500 | gp3 | in-use | us-gov-east-1a | Yes |

---

## Application Load Balancers

| Name | DNS Name | Type | Scheme | VPC |
|---|---|---|---|---|
| CarbonERPServic-fxkdazrd | CarbonERPServic-fxkdazrd-276575935.us-gov-east-1.elb.amazonaws.com | application | internet-facing | vpc-0577e54eb7bafc84c |
| CarbonMESServic-baxnnhrf | CarbonMESServic-baxnnhrf-2118248476.us-gov-east-1.elb.amazonaws.com | application | internet-facing | vpc-0577e54eb7bafc84c |

### Target Groups

| Name | Protocol | Port | Target Type | VPC | Health Check |
|---|---|---|---|---|---|
| HTTP20260107000759809500000001 | HTTP | 3000 | ip | vpc-0577e54eb7bafc84c | /health |
| HTTP20260107000759813900000002 | HTTP | 3000 | ip | vpc-0577e54eb7bafc84c | /health |
| HTTP20250925021329054500000005 | HTTP | 3000 | ip | vpc-0d3f47b17f0c79920 | /health |
| HTTP20250925092116833500000001 | HTTP | 3000 | ip | vpc-0d3f47b17f0c79920 | /health |

---

## ECS (Elastic Container Service)

### Clusters

| Cluster Name | Status | Running Tasks | Active Services |
|---|---|---|---|
| carbon-prod-CarbonClusterCluster-bbtexkhn | ACTIVE | 2 | 2 |

### Services

| Service | Status | Launch Type | Desired | Running |
|---|---|---|---|---|
| CarbonERPService | ACTIVE | FARGATE | 1 | 1 |
| CarbonMESService | ACTIVE | FARGATE | 1 | 1 |

### Active Task Definitions

| Task Definition |
|---|
| carbon-prod-CarbonClusterCluster-bbtexkhn-CarbonERPService:111 |
| carbon-prod-CarbonClusterCluster-bbtexkhn-CarbonMESService:102 |
| carbon-prod-CarbonClusterCluster-bbfnvkxh-CarbonERPService:231 |
| carbon-prod-CarbonClusterCluster-bbfnvkxh-CarbonMESService:231 |
| carbon-barbinbrad-CarbonClusterCluster-cumuutvd-CarbonERPService:1 |
| carbon-barbinbrad-CarbonClusterCluster-cumuutvd-CarbonMESService:1 |

---

## ECR (Elastic Container Registry)

| Repository | URI |
|---|---|
| carbon/erp | 453096467244.dkr.ecr.us-gov-east-1.amazonaws.com/carbon/erp |
| carbon/mes | 453096467244.dkr.ecr.us-gov-east-1.amazonaws.com/carbon/mes |
| sst-asset | 453096467244.dkr.ecr.us-gov-east-1.amazonaws.com/sst-asset |

---

## RDS

### DB Instances

None (database runs on EC2 via Supabase self-hosted).

### DB Subnet Groups

| Name | VPC | Subnets |
|---|---|---|
| rds-ec2-db-subnet-group-1 | vpc-01df94682daccf2f0 | subnet-0270118bf328dd7fa, subnet-02fa67997bfb766d4, subnet-003098a4e24f0ea86 |

---

## DynamoDB

No tables.

---

## EFS

No file systems.

---

## Lambda Functions

| Function Name | Runtime | Memory (MB) | Timeout (s) |
|---|---|---|---|
| FunctionDeployStack-FunctionDeployFunctionF43ECD38-86Wg6Rsabegm | nodejs18.x | 10240 | 600 |

---

## IAM

### Users

| User Name | Created |
|---|---|
| Administrator | 2025-08-28 |
| barbinbrad | 2025-08-28 |
| carbon-barbinbrad-smtp | 2025-09-04 |
| fastabase-barbinbrad-smtp | 2025-08-29 |
| fastabase-demo-smtp | 2025-08-29 |

### Roles (project-related)

| Role Name | Created |
|---|---|
| CarbonEC2toS3Role | 2025-09-17 |
| CarbonECR | 2025-09-24 |
| carbon-prod-CarbonERPServiceExecutionRole-bdnfszaz | 2026-01-07 |
| carbon-prod-CarbonERPServiceTaskRole-bazeevbx | 2026-01-07 |
| carbon-prod-CarbonMESServiceExecutionRole-mbztfrwf | 2026-01-07 |
| carbon-prod-CarbonMESServiceTaskRole-bbkaxmwo | 2026-01-07 |
| carbon-prod-CarbonERPServiceExecutionRole-baufmoea | 2025-09-25 |
| carbon-prod-CarbonERPServiceTaskRole-bcektvxo | 2025-09-25 |
| carbon-prod-CarbonMESServiceExecutionRole-bcafcdva | 2025-09-25 |
| carbon-prod-CarbonMESServiceTaskRole-dftcdvzk | 2025-09-25 |
| carbon-govcloud-CarbonERPServiceExecutionRole-russmbkz | 2025-09-25 |
| carbon-govcloud-CarbonERPServiceTaskRole-xchhhuex | 2025-09-25 |
| carbon-govcloud-CarbonMESServiceExecutionRole-rcbmdutr | 2025-09-25 |
| carbon-govcloud-CarbonMESServiceTaskRole-eetkorhw | 2025-09-25 |

### Customer-Managed Policies

None (all roles use AWS-managed or inline policies).

---

## ACM Certificates

| Domain | Status |
|---|---|
| carbon.ms | ISSUED |
| itar.carbon.ms | ISSUED |
| mes.itar.carbon.ms | ISSUED |

---

## Route 53

### Hosted Zones

8 private hosted zones named "sst." (used by SST for service discovery).

---

## Secrets Manager

| Secret Name |
|---|
| carbon/github/ci/token |
| carbon/supabase/jwt-secet |
| carbon/supabase/postgres-password |
| carbon/supabase/anon-key |
| carbon/supabase/service-key |
| carbon/supabase/dashboard-auth |
| carbon/supabase/secret-key-base |
| carbon/supabase/vault-key |
| carbon/supabase/jwt |
| carbon/supabase/google-client-secret |
| carbon/supabase/resend-api-key |
| carbon/authelia/jwt-secret |
| carbon/authelia/storage-key |
| carbon/authelia/auth |

---

## SSM Parameters

| Parameter Name | Type |
|---|---|
| /sst/bootstrap | String |
| /sst/passphrase/carbon/barbinbrad | SecureString |
| /sst/passphrase/carbon/dev | SecureString |
| /sst/passphrase/carbon/prod | SecureString |

---

## CloudWatch Log Groups

| Log Group | Retention | Stored (MB) |
|---|---|---|
| /sst/cluster/.../CarbonERPService (active) | 30 days | ~181 |
| /sst/cluster/.../CarbonMESService (active) | 30 days | ~134 |
| /sst/cluster/.../CarbonERPService (old) | 30 days | ~53 |
| /sst/cluster/.../CarbonMESService (old) | 30 days | ~16 |
| RDSOSMetrics | 30 days | 0 |

---

## CloudFormation Stacks

| Stack Name | Status | Created |
|---|---|---|
| FunctionDeployStack | UPDATE_COMPLETE | 2025-09-22 |
| CDKToolkit | CREATE_COMPLETE | 2025-09-22 |
| SupabaseVPC | CREATE_COMPLETE | 2025-08-29 |

---

## KMS Keys

8 KMS keys in use (all AWS-managed, no custom aliases).

---

## Services with No Resources

The following services were checked and have no resources:

- DynamoDB (no tables)
- EFS (no file systems)
- NAT Gateways (none)
- SNS (no topics)
- SQS (no queues)
- SES (no identities)
- VPC Peering (no connections)

---

## Summary of Required IAM Permissions for New Account

The new account should have permissions for the following AWS services:

| Service | Permissions Needed |
|---|---|
| EC2 | Full (instances, VPCs, subnets, security groups, EIPs, EBS, route tables, IGWs, VPC endpoints, NACLs) |
| ECS | Full (clusters, services, tasks, task definitions) |
| ECR | Full (repositories, image push/pull) |
| ELB v2 | Full (ALB, target groups, listeners) |
| S3 | Full (bucket create, read, write, list) |
| IAM | Full (users, roles, policies, instance profiles) |
| ACM | Full (request, validate, manage certificates) |
| Route 53 | Full (hosted zones, record sets) |
| Lambda | Full (create, invoke, manage functions) |
| Secrets Manager | Full (create, read, update secrets) |
| SSM Parameter Store | Full (create, read, update parameters) |
| CloudWatch Logs | Full (log groups, log streams, put/get logs) |
| CloudFormation | Full (create, update, delete stacks) |
| KMS | Full (create keys, encrypt, decrypt) |
| RDS | Subnet groups (for potential future use) |
| STS | AssumeRole (for cross-service access) |
| CloudWatch | Metrics and alarms (for monitoring) |
