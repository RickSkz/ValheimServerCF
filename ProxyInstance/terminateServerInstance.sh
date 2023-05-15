#!/bin/bash
server=$(aws ec2 describe-instances --filters "Name=instance-type,Values=t3.medium" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].InstanceId" --output text)
aws ec2 terminate-instances --instance-ids $server



