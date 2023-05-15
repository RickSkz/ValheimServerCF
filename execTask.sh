#!bash
aws ecs execute-command --cluster ValheimCluster \
    --task $1 \
    --container ValheimStandbyContainer \
    --interactive \
    --command "bash"
