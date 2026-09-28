#!/usr/bin/env python3
"""Draw the home-screen icon (blue square, white map pin) as PNGs, no dependencies."""
import math, os, struct, zlib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def png(path, size):
    teal, white, dot = (37, 99, 235), (255, 255, 255), (234, 88, 12)
    ss = 3  # supersampling
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    u = (x + (sx + .5) / ss) / size; v = (y + (sy + .5) / ss) / size
                    c = teal
                    # pin: circle head + triangle tail
                    cx, cy, r = .5, .42, .22
                    d = math.hypot(u - cx, v - cy)
                    tail = v >= cy and v <= .80 and abs(u - cx) <= r * (1 - (v - cy) / (.80 - cy)) * .98
                    if d <= r or tail:
                        c = white
                    if math.hypot(u - cx, v - cy) <= .09:
                        c = dot
                    for i in range(3): acc[i] += c[i]
            row += bytes(a // (ss * ss) for a in acc)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(os.path.join(ROOT, path), 'wb').write(data)

for name, size in [('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512)]:
    png(name, size); print(name)
