#!bash
aws ecs update-service --cluster ValheimCluster --service ValheimECSStandbyService --task-definition $1 --force-new-deployment --enable-execute-command
