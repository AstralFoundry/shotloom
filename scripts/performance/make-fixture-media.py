"""Deterministic 1080p PNG; no external image libraries or user media."""
import pathlib
import struct
import sys
import zlib

width, height = 1920, 1080
rows = []
for y in range(height):
    row = bytearray([0])
    for x in range(width):
        row.extend((((x // 4) * 17 + (y // 4) * 13 + (x // 4 * y // 4) % 73) % 256,
                    (x // 4 + y // 4) % 256, (x // 8 + y // 8) % 256))
    rows.append(row)

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(b"".join(rows), 6)) + chunk(b"IEND", b""))
assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) == 1612729
pathlib.Path(sys.argv[1]).write_bytes(png)
print("Created 1920x1080 RGB fixture:", len(png), "bytes")
