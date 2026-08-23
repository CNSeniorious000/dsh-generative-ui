#!/bin/sh
git init -q .
echo hello > a.txt
git add -A && git -c user.email=t@t -c user.name=t commit -q -m 'first commit'
echo more >> a.txt
git -c user.email=t@t -c user.name=t commit -qam 'second commit: extend a.txt'
echo x > b.txt
git add -A && git -c user.email=t@t -c user.name=t commit -q -m 'add b.txt'
