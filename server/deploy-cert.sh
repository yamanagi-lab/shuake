#!/bin/sh
# certbot 拿到新证书后调用：把证书复制给评论服务，服务每 5 分钟检查一次，自动换上新证书
set -e
src=/etc/letsencrypt/live/shuake-ip
dst=/var/lib/shuake/tls
install -d -o shuake -g shuake -m 700 "$dst"
install -o shuake -g shuake -m 600 "$src/privkey.pem" "$dst/privkey.pem.new"
install -o shuake -g shuake -m 600 "$src/fullchain.pem" "$dst/fullchain.pem.new"
mv "$dst/privkey.pem.new" "$dst/privkey.pem"
mv "$dst/fullchain.pem.new" "$dst/fullchain.pem"
