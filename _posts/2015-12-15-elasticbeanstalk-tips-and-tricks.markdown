---
layout: post
title:  "ElasticBeanstalk Tips and Tricks"
date:   2015-12-15 12:00:00
categories: AWS
---
This page includes a list of tips and tricks for new Elastic Beanstalk users. They are not [eb_deployer](https://github.com/ThoughtWorksStudios/eb_deployer) specific, but mostly has a straightforward implementation in [eb_deployer](https://github.com/ThoughtWorksStudios/eb_deployer).

* [Set autoscale group health check to get self-healing work](#set-autoscale-group-health-check-to-get-self-healing-work)
* [SSL certificates in 3 steps](#ssl-certificates-in-3-steps)
* [Set "inactive_settings" for saving cost on blue green deployment](#set-inactive_settings-for-saving-cost-on-blue-green-deployment)
* [Setup Instance Profile For Your EC2 Instances](#setup-instance-profile-for-your-ec2-instances)
* [How to manage application configuration](#how-to-manage-application-configuration)


Set autoscale group health check to get self-healing work
=====
Autoscale group is awesome not only because it provides elastic scaling but also it is a self-healing mechanism. Bad instances can be detected, terminated and new instances can be provisioned to replace them. But this is not by default enabled for ElasticBeanstalk environments. To enable that you need setup both ELB health check and autoscale group health check.

To enable ELB health check, in option settings section:
{% highlight yaml %}
  - namespace: aws:elasticbeanstalk:application
    option_name: Application Healthcheck URL
    value: "/"
{% endhighlight %}
To enable autoscale group health check, in your .ebextensions folder put in a config file:
{% highlight yaml %}
 Resources:
   AWSEBAutoScalingGroup:
     Type: "AWS::AutoScaling::AutoScalingGroup"
     Properties:
       HealthCheckType: "ELB"
       HealthCheckGracePeriod: "600"
{% endhighlight %}

The second step (autoscale group health check) is often get skipped, which will result in a weird situation: when ELB marks an instance bad and removes it from load balancing, autoscale group still thinks the instance is good so there is no new instance provisioned to replace it. You can end up with running out instances and whole service goes down.

Read more at: http://www.onegeek.com.au/articles/lessons-learned-configuring-a-ha-multi-docker-container-elastic-beanstalk

SSL certificates in 3 steps
====
Today, anything you deployed with serious usage should be under https. It is very quick to configure SSL with [eb_deployer](https://github.com/ThoughtWorksStudios/eb_deployer) given you have uploaded the certificates follow [AWS guide](http://docs.aws.amazon.com/IAM/latest/UserGuide/ManagingServerCerts.html#UploadSignedCert).

1. Use aws cli to figure out certificates ARNS:
  {% highlight bash %}
    % aws iam list-server-certificates
    {
        "ServerCertificateMetadataList": [
            {
                "ServerCertificateId": "XXXXXXXXXX",
                "ServerCertificateName": "my-production-ssl-certificate",
                "Expiration": "2015-12-18T23:59:59Z",
                "Path": "/",
                "Arn": "arn:aws:iam::xxxxxxxx:server-certificate/my-production-ssl-certificate",
                "UploadDate": "2015-06-18T18:37:03Z"
            },
            {
                "ServerCertificateId": "XXXXXXXXX",
                "ServerCertificateName": "my-staging-ssl-certificate",
                "Expiration": "2016-07-06T12:00:00Z",
                "Path": "/",
                "Arn": "arn:aws:iam::xxxxxxx:server-certificate/my-staging-ssl-certificate",
                "UploadDate": "2015-06-29T18:53:24Z"
            },
       }]
    }
    {% endhighlight %}

1. Configure aws:elb:loadbalancer#SSLCertificateId option for each environment. Note the SSLCertificateId value should actually be certificate ARN in previous commands output
    {% highlight yaml %}
    common:
      option_settings:
        - namespace: aws:elb:loadbalancer
          option_name: LoadBalancerHTTPSPort
          value: "443"
        - namespace: aws:elasticbeanstalk:application
          option_name: Application Healthcheck URL
          value: "/"

    environments:
      staging:
        option_settings:
          - namespace: aws:elb:loadbalancer
            option_name: SSLCertificateId
            value: "arn:aws:iam::xxxxxxx:server-certificate/my-staging-ssl-certificate"
     production:
        option_settings:
          - namespace: aws:elb:loadbalancer
            option_name: SSLCertificateId
            value: "arn:aws:iam::xxxxxxx:server-certificate/my-production-ssl-certificate"

    {% endhighlight %}

1. Deploy and give it a try.

Set "inactive_settings" for saving cost on blue green deployment
====
There are mostly 2 flavors of blue green implementation on AWS: switch routing on ELB (e.g. asguard) or on DNS record (e.g. our [eb_deployer](https://github.com/ThoughtWorksStudios/eb_deployer)). Both has pros and cons. DNS switching approach is safer for on going requests and less intrusive for application's own infrastructure, but has the con that it is never theoretically safe to terminate inactive environment because of DNS caching.

But isn't keep a full environment not serving requests a big waste? [eb_deployer](https://github.com/ThoughtWorksStudios/eb_deployer) solves this problem by allow you set special settings to environments that only applied when they become inactive.

Here is an example using "inactive-settings option" to change the autoscale group min size to 1:
{% highlight yaml %}
    option_settings:
      - namespace: aws:autoscaling:asg
        option_name: MinSize
        value: "5"
    inactive_settings:
      - namespace: aws:autoscaling:asg
        option_name: MinSize
        value: "1"
{% endhighlight %}

With this setting an environment will scale down to 1 instance gracefully along with traffic dropping after become inactive.

Similarly if you are confident traffic to inactive will die out in a specific period of time, you can use following settings to gradually kill idle instances to 0 to save cost.
{% highlight yaml %}
    option_settings:
      # providing least redundancy
      - namespace: aws:autoscaling:asg
        option_name: MinSize
        value: "2"
      # make sure cooldown is reset back to default when environment become active again
      - namespace: aws:autoscaling:asg
        option_name: Cooldown
        value: "360"
    inactive_settings:
      # reduce instance count to 0 to save cost
      - namespace: aws:autoscaling:asg
        option_name: MinSize
        value: "0"
      # make sure cooldown is big enough to cope with DNS cache
      - namespace: aws:autoscaling:asg
        option_name: Cooldown
        value: "900"
{% endhighlight %}

The above configuration will wait at least 15 minutes (900 seconds) to kill the last instance in inactive, and in most case it is safe. Also the scale down process is off from the deployment process, so the deployment time will not increase even you have long Cooldown buffer.

Setup Instance Profile For Your EC2 Instances
====
Your application will likely to use other AWS services. It is very easy to make a mistake directly put your AWS keys into the app for making those API calls work. Instead you should setup an IAM instance profile and make your instances bootstrap with it. This way you can exactly define what the machine can do and avoid the risk that someone uses your leaked AWS keys to steal your customer data or farm Bitcoins.

You can use AWS cli tool to setup instance profiles and manage it outside of your Elastic Beanstalk Environments. But with [eb_deployer](https://github.com/ThoughtWorksStudios/eb_deployer) you have a more self-contained way doing this:

Create a CloudFormation template to define your resources stack, e.g. config/my-resources.json:
{% highlight json %}
{
  "Outputs": {
    "InstanceProfile": {
      "Description": "defines what ec2 instance can do with aws resources",
      "Value": { "Ref":  "InstanceProfile" }
    }
  },

  "Resources": {
    "Role": {
      "Type": "AWS::IAM::Role",
      "Properties": {
        "AssumeRolePolicyDocument": {
          "Statement": [{
            "Effect": "Allow",
            "Principal": {
              "Service": ["ec2.amazonaws.com"]
            },
            "Action": ["sts:AssumeRole"]
          }]
        },
        "Path": "/",
        "Policies": [ {
          "PolicyName": "S3Access",
          "PolicyDocument": {
            "Statement": [
              {
                "Effect": "Allow",
                "Action": [
                  "s3:Get*",
                  "s3:List*",
                  "s3:PutObject"
                ],
                "Resource": "*"
              }
            ]
          }
        }, {
          "PolicyName": "SQSAccess",
          "PolicyDocument": {
            "Statement": [ {
              "Effect": "Allow",
              "Action": [
                "sqs:ChangeMessageVisibility",
                "sqs:DeleteMessage",
                "sqs:ReceiveMessage",
                "sqs:SendMessage"
              ],
              "Resource": "*"
            }]
          }
        }]
      }
    },
    "InstanceProfile": {
      "Type": "AWS::IAM::InstanceProfile",
      "Properties": {
        "Path": "/",
        "Roles": [ { "Ref": "Role" } ]
      }
    }
  }
}
{% endhighlight %}

Add a "resources" section into your eb_deployer.yml
{% highlight yaml %}
  resources:
    template: config/my-resources.json
    capabilities:
      - CAPABILITY_IAM
    outputs:
      InstanceProfile:
        namespace: aws:autoscaling:launchconfiguration
        option_name: IamInstanceProfile
{% endhighlight %}
In the above example we defined an instance profile with policies enable specific accesses to S3 and SQS. Then map the instance profile name (output of the template) to Elastic Beanstalk option settings. Now every instance provisioned by Elastic Beanstalk will have the specified access, without needs of our AWS keys.

How to manage application configuration
======

Environment variables is the most straightforward way to configure simple application on Elastic Beanstalk. What needed is just a list of option settings, such as following:
{% highlight yaml %}
    - namespace: aws:elasticbeanstalk:application:environment
      option_name: MY_DATABASE
      value: mydatabase.myinterneldomain.com
{% endhighlight %}

Then your application can read configuration values via environment variables at runtime. (Or via system properties if it is a java application).

But what if the application needs thirty configuration options? In this case downloading configuration files from somewhere else makes a lot of sense.

For example you can store your configuration files into a S3 bucket, and download them to proper places during deployment. Here is a sample config file in .ebextensions doing that:

{% highlight yaml %}
"/usr/share/tomcat7/lib/my-app.properties":
    mode: "000777"
    owner: ec2-user
    group: ec2-user
    source: https://my-app-config.s3.amazonaws.com/my-app.properties

Resources:
  AWSEBAutoScalingGroup:
    Metadata:
      AWS::CloudFormation::Authentication:
        S3Access:
          type: S3
          roleName: aws-elasticbeanstalk-ec2-role
          buckets: my-app-configs
{% endhighlight %}

The Resources part in previous example is for granting S3 bucket access. You can use IAM instance profile to setup the access if fine-grained control is needed. Take a look at previous tips: [Setup Instance Profile For Your EC2 Instances](#setup-instance-profile-for-your-ec2-instances)

This approach also applies to other type of data your application need -- such as licenses, database seed data.

Thanks [@cpilsworth](https://twitter.com/cpilsworth) for suggesting this tip. And the tip itself is from  [this stackexchange answer](http://serverfault.com/questions/675217/getting-files-from-an-s3-bucket-using-iam-role-credentials/678032#678032) by [@diffa](http://serverfault.com/users/76266/diffa).
