'use strict';

/*
 * This test is a regression test for joyent/node#8897.
 */

const common = require('../common');
const net = require('net');

const clients = [];

const server = net.createServer(function onClient(client) {
  clients.push(client);

  if (clients.length === 2) {
    /*
     * Enroll two timers, and make the one supposed to fire first
     * unenroll the other one supposed to fire later. This mutates
     * the list of unref timers when traversing it, and exposes the
     * original issue in joyent/node#8897.
     */
    clients[0].setTimeout(1, function onTimeout() {
      clients[1].setTimeout(0);
      clients[0].end();
      clients[1].end();
    });

    // Use a delay that is higher than the lowest timer resolution accross all
    // supported platforms, so that the two timers don't fire at the same time.
    clients[1].setTimeout(50);
  }
});

server.listen(0, common.localhostIPv4, function() {
  var nbClientsEnded = 0;

  function addEndedClient(client) {
    ++nbClientsEnded;
    if (nbClientsEnded === 2) {
      server.close();
    }
  }

  const client1 = net.connect({ port: this.address().port });
  client1.on('end', addEndedClient);

  const client2 = net.connect({ port: this.address().port });
  client2.on('end', addEndedClient);
});
