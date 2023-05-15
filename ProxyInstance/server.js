const schedule = require('node-schedule');
var proxy = require('udp-proxy');
var AWS = require('aws-sdk');
const express = require('express');

AWS.config.update({region: 'us-east-1'});

const ec2 = new AWS.EC2({ region: 'us-east-1' });
const ecs = new AWS.ECS({ region: 'us-east-1' });
const autoscaling = new AWS.AutoScaling();

const cloudwatchlogs = new AWS.CloudWatchLogs();

const valheimSecurityGroupId = 'sg-0924f25f3a5a7fb8f';
const valheimSubnetId = 'subnet-0698a86eac2e11802';
const clusterName = 'ValheimCluster';
const serviceName = 'ValheimServerService';
const serverASGName = 'ECSServerAutoScalingGroup';
const CWLogGroupName = 'valheim';
const CWLogStreamName = 'valheim-proxy';

//We install docker, mount our EFS volume, and run our Valheim container
const userData = `#!/bin/bash
yum update -y
yum install -y docker
yum install -y amazon-efs-utils
systemctl enable docker
systemctl start docker
mkdir -p /mnt/efs
sudo mount -t nfs -o \
nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport fs-0dea2fe3f17e89d01.efs.us-east-1.amazonaws.com:/   /mnt/efs 

sudo docker run -d \
    --name valheim-server \
    --cap-add=sys_nice \
    --stop-timeout 120 \
    -p 80:80/tcp \
    -p 2456-2457:2456-2457/udp \
    -v /mnt/efs:/config \
    -v /mnt/efs:/opt/valheim \
    -e SERVER_NAME="RickServer" \
    -e WORLD_NAME="IMPIValheim" \
    -e SERVER_PASS="imperio" \
    -e SERVER_PUBLIC=true \
    -e STATUS_HTTP=true \
    -e STATUS_HTTP_PORT=80 \
    lloesche/valheim-server`




const userDataEncoded = new Buffer(userData).toString('base64');

var targetIp = '172.31.0.10';
var checkURL = `http://${targetIp}/status.json`;

var shutdownTime = 20;
var counter = 0;
var desiredCount = '';
var serverOn = false;
var serviceArn = ''
var proxyServer;
var instanceId = '';

const healthApp = express();

uploadLogs('App started...');

//Spin up health server
healthApp.get('/health', (req, res) => {
  res.send('Hello, World!');
});

healthApp.listen(80, () => {
  uploadLogs('Health server running on port 80');
});

//Set up UDP proxy via port 2456
setUpProxy();

const scheduleOptions = { rule: '*/1 * * * *' };

const checkServerJob = schedule.scheduleJob(scheduleOptions, function () {
  getInstanceParameters();
  fetch(checkURL).then(response => response.json())
  .then(data => {
    let playerCount = data.player_count;
    countTillShutdown(playerCount);
  }).catch(error => {
    uploadLogs('Server offline')
    counter = 0;
  })
})


function setUpProxy() {

  try {
    proxyServer.close(() => {
      uploadLogs('Proxy reset');
    });
  } catch {
    
  }

  let options = {
    address: targetIp,
    port: 2456,
    localport: 2456,
    timeOutTime: 10000
  };

  // This is the function that creates the server, each connection is handled internally
  proxyServer = proxy.createServer(options);

  // this should be obvious
  proxyServer.on('listening', function (details) {
      uploadLogs('udp-proxy-server ready on ' + details.server.family + '  ' + details.server.address + ':' + details.server.port);
      uploadLogs('traffic is forwarded to ' + details.target.family + '  ' + details.target.address + ':' + details.target.port);
  });

  // 'bound' means the connection to server has been made and the proxying is in action
  proxyServer.on('bound', function (details) {
  //    uploadLogs('proxy is bound to ' + details.route.address + ':' + details.route.port);
  //    uploadLogs('peer is bound to ' + details.peer.address + ':' + details.peer.port);
  });

  // 'message' is emitted when the server gets a message
  proxyServer.on('message', function (message, sender) {
  //    uploadLogs('message from ' + sender.address + ':' + sender.port);
      if(!serverOn) {
        serverOn=true
        uploadLogs("UDP traffic received - Creating server");
        createServerInstance();
      }
  });

  // 'proxyMsg' is emitted when the bound socket gets a message and it's send back to the peer the socket was bound to
  proxyServer.on('proxyMsg', function (message, sender, peer) {
      //uploadLogs('answer from ' + sender.address + ':' + sender.port);
  });

  // 'proxyClose' is emitted when the socket closes (from a timeout) without new messages
  proxyServer.on('proxyClose', function (peer) {
  //    uploadLogs('disconnecting socket from ' + peer.address);
  });

  proxyServer.on('proxyError', function (err) {
      uploadLogs('ProxyError! ' + err);
  });

  proxyServer.on('error', function (err) {
      uploadLogs('Error! ' + err);
  });

}


function countTillShutdown(playerCount) {

  if (playerCount > 0) {
    uploadLogs(`Server is online - ${playerCount} players connected`)
    counter = 0;
  }
  if (playerCount == 0) {
    uploadLogs(`Server is online - no players connected`)
    counter++;
  }
  if (counter >= shutdownTime) {
    uploadLogs("Shutting down server")
    terminateServerInstance();
    serverOn=false;
  }
  let remainingTime = (shutdownTime - counter);
  uploadLogs('Countdown till shutdown = ' + remainingTime + ' minutes');
}

//Creates the Valheim Server
function createServerInstance() {

  var params = {
    AutoScalingGroupName: serverASGName,
    DesiredCapacity: 1
  };

  autoscaling.setDesiredCapacity(params, (err, data) => {
    if (err) {
      uploadLogs('There was a problem setting the AutoScalingGroup desired capacity')
      serverOn = false;
    } else {
      uploadLogs('ASG desired capacity set to 1');
      instanceId = data.InstanceId;
    }
  });

  params = {
    cluster: clusterName,
    service: serviceName,
    desiredCount: 1
  };
  ecs.updateService(params, (error, data) => {
    if (error) {
      uploadLogs(error.toString());
      uploadLogs('There was a problem setting the service desired count to 1');
      serverOn = false;
    } else {
      uploadLogs('Desired task count has been set to 1');
      //uploadLogs(data);
    }
  });

}

function getInstanceParameters() {
  
  var params = {
    cluster: clusterName,
    services: [serviceName]
  };
  
  ecs.describeServices(params, (error, data) => {
    if (error) {
      uploadLogs(error.toString());
      uploadLogs('There was an issue retrieving ECS service parameters')
    } else {
      //uploadLogs(data);
      desiredCount = data.services[0].desiredCount;
      serviceArn = data.services[0].serviceArn;
      uploadLogs('Current desired task count = ' + desiredCount);
      if (desiredCount > 0) {
        serverOn = true;
      } else {
        serverOn = false;
      }
    }
  });

    
  autoscaling.describeAutoScalingInstances({}, (err, data) => {
    if (err) {
      uploadLogs(err.toString());
      uploadLogs('There was a problem getting instance information');
    } else {
      let activeInstance = data.AutoScalingInstances.filter(instance => instance.AutoScalingGroupName === serverASGName).filter(instance => instance.LifecycleState === 'InService');
      if (activeInstance.length > 0) {
        instanceId = activeInstance[0].InstanceId;
        uploadLogs('InstanceId of server instance is ' + instanceId);
      } else {
        uploadLogs('There is no active server instance');
      }
      
    }
  });
    
  params = {
    InstanceIds: [instanceId]
  };

  ec2.describeInstances(params, function(err, data) {
    if (err) {
      uploadLogs(err.toString());
      uploadLogs('There was a problem retrieving instance IP address')
    } else {
      let newTargetIp = data.Reservations[0].Instances[0].PrivateIpAddress;
      if (newTargetIp != targetIp) {
        targetIp = newTargetIp;
        setUpProxy();
      }
      //targetIp = data.Reservations[0].Instances[0].PublicIpAddress;
      checkURL = `http://${targetIp}/status.json`;
      uploadLogs('Target URL is ' + checkURL);
    }              
  });

}

function terminateServerInstance() {

  var params = {
    cluster: clusterName,
    service: serviceArn,
    desiredCount: 0
  };
  ecs.updateService(params, (error, data) => {
    if (error) {
      uploadLogs(error.toString());
      uploadLogs('There was a problem settint the service desired count to 0');
    } else {
      uploadLogs('Desired task count has been set to 0')
      //uploadLogs(data);
      desiredCount = 0;
    }
  });

  params = {
    AutoScalingGroupName: serverASGName,
    DesiredCapacity: 0
  };

  autoscaling.setDesiredCapacity(params, (err, data) => {
    if (err) {
      uploadLogs(err.toString());
      uploadLogs('There was a problem setting the AutoScalingGroup desired capacity')
    } else {
      uploadLogs('ASG desired capacity set to 0');
    }
  });

  counter = 0;

}

//Send logs to CloudWatch logs
function uploadLogs(data) {

  const params = {
    logGroupName: CWLogGroupName,
    logStreamName: CWLogStreamName,
    logEvents: [
      {
        message: data,
        timestamp: Date.now()
      }
    ]
  };
  
  // Send the log events to the log group
  cloudwatchlogs.putLogEvents(params, function(err, data) {
    if (err) {
      console.log(err);
    } 
  });

}