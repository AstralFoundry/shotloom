"""Relay emulator DNS through the runner's resolver; some runners block guest UDP DNS."""
import argparse
from pathlib import Path
import socket
import socketserver
import struct
import threading


def host_answer(packet, host, address):
    """Pin only the test origin to the address resolved on the CI host."""
    try:
        if len(packet) < 12 or packet[2] & 0x80 or packet[4:6] != b'\x00\x01':
            return
        offset, labels = 12, []
        while packet[offset]:
            length = packet[offset]
            if length > 63:
                return
            labels.append(packet[offset + 1:offset + 1 + length].decode('ascii'))
            offset += length + 1
        offset += 1
        kind, group = struct.unpack('!HH', packet[offset:offset + 4])
        if '.'.join(labels).lower() != host or group != 1:
            return
        question = packet[12:offset + 4]
        answer = b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 60, 4) + socket.inet_aton(address) if kind == 1 else b''
        return packet[:2] + struct.pack('!HHHHH', 0x8180, 1, bool(answer), 0, 0) + question + answer
    except (IndexError, UnicodeError, struct.error):
        return


def relay(upstream, port, origin=None):
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            packet, downstream = self.request
            if origin:
                response = host_answer(packet, *origin)
                if response is not None:
                    downstream.sendto(response, self.client_address)
                    return
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
    question = b'\x08shotloom\x070xfiang\x03com\x00'
    query = b'\xab\xcd' + struct.pack('!HHHHH', 0x0100, 1, 0, 0, 0) + question + struct.pack('!HH', 1, 1)
    response = host_answer(query, 'shotloom.0xfiang.com', '192.0.2.1')
    assert response[:2] == query[:2] and response[-4:] == socket.inet_aton('192.0.2.1')
    assert host_answer(query, 'other.example', '192.0.2.1') is None
    assert host_answer(b'invalid', 'shotloom.0xfiang.com', '192.0.2.1') is None
    ipv6 = host_answer(query[:-4] + struct.pack('!HH', 28, 1), 'shotloom.0xfiang.com', '192.0.2.1')
    assert ipv6[6:8] == b'\x00\x00'
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
        host = 'shotloom.0xfiang.com'
        address = socket.gethostbyname(host)
        print(f'CI origin DNS: {host} -> {address}', flush=True)
        with relay((resolver, 53), 53, (host, address)) as server:
            server.serve_forever()
