#!/bin/sh
service_pid=$1
shift
exec 3<&0
"$@" <&3 &
exec 3<&-
engine_pid=$!
cleanup() {
  trap '' TERM INT HUP
  kill -TERM -$$ 2>/dev/null
  sleep 1
  kill -KILL -$$ 2>/dev/null
  exit 0
}
trap cleanup TERM INT HUP
while kill -0 "$service_pid" 2>/dev/null && kill -0 "$engine_pid" 2>/dev/null; do
  sleep 1
done
cleanup
