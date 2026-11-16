"""Relay emulator DNS through the runner's resolver; some runners block guest UDP DNS."""
import argparse
from pathlib import Path
import socket
import socketserver
import threading


def relay(upstream, port):
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            packet, downstream = self.request
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
                connection.settimeout(5)
                try:
                    connection.sendto(packet, upstream)
                    response, _ = connection.recvfrom(65535)
                    downstream.sendto(response, self.client_address)
                except OSError:
                    pass  # DNS clients retry; never invent a successful answer.
    return socketserver.ThreadingUDPServer(('127.0.0.1', port), Handler)


def self_test():
    class Echo(socketserver.BaseRequestHandler):
        def handle(self):
            packet, connection = self.request
            connection.sendto(packet, self.client_address)
    with socketserver.ThreadingUDPServer(('127.0.0.1', 0), Echo) as upstream:
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        with relay(upstream.server_address, 0) as downstream:
            threading.Thread(target=downstream.serve_forever, daemon=True).start()
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                client.settimeout(2)
                for packet in [b'first\x00packet', b'second\xffpacket']:
                    client.sendto(packet, downstream.server_address)
                    assert client.recvfrom(65535)[0] == packet
            downstream.shutdown()
        upstream.shutdown()
    print('DNS relay preserves request and response bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        resolver = next(line.split()[1] for line in Path('/etc/resolv.conf').read_text().splitlines() if line.startswith('nameserver '))
        with relay((resolver, 53), 53) as server:
            server.serve_forever()
