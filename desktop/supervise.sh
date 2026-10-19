#!/bin/sh
# Keep the executor and its tools in this process group. If the local service
# disappears, terminate the whole group rather than leaving approved tools alive.
"$1" serve --hostname 127.0.0.1 --port 0 &
engine_pid=$!
service_pid=$2
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
