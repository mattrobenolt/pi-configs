#!/usr/bin/env bash
cd /tmp
exec env SLACK_WORKSPACE_URL="https://planetscale.slack.com" bunx agent-slack "$@"
