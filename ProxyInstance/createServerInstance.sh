#!/bin/bash
aws ec2 run-instances --image-id ami-0fbb93b2aa2316ad2 --count 1 --instance-type t3.medium --key-name ValheimKeyPair \
--security-group-ids sg-0924f25f3a5a7fb8f --subnet-id subnet-0698a86eac2e11802 --associate-public-ip-address --private-ip-address '172.31.0.10' \
--instance-market-options '{"MarketType":"spot"}' --user-data file://userData.txt