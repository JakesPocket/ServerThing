#!/usr/bin/env python3
"""
Hardware Input Bridge for Spotify Car Thing
Reads from /dev/input/event* and sends to server via HTTP
Uses direct event reading (no getevent required)
"""

import struct
import json
import time
from threading import Thread
from urllib import request
from urllib.error import URLError

# Event device mapping
DEVICE_BUTTONS = '/dev/input/event0'  # gpio-keys (buttons)
DEVICE_DIAL = '/dev/input/event1'      # rotary encoder

# Key codes (actual values from hardware)
KEY_ESC = 1        # Back button
KEY_1 = 2          # Preset 1
KEY_2 = 3          # Preset 2
KEY_3 = 4          # Preset 3
KEY_4 = 5          # Preset 4
KEY_ENTER = 28     # Dial click

# Virtual key codes to send to server
KEY_BACK = 158
KEY_LEFT = 105
KEY_RIGHT = 106
BTN_0 = 256
BTN_1 = 257
BTN_2 = 258
BTN_3 = 259

# Event types
EV_KEY = 0x01
EV_REL = 0x02
REL_DIAL = 0x06

SERVER_URL = 'http://127.0.0.1:3000'

# Input event struct format: timeval (2 longs), type (short), code (short), value (int)
# On 32-bit ARM: LL (8 bytes) HH (4 bytes) i (4 bytes) = 16 bytes
EVENT_FORMAT = 'llHHi'
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)

def send_input(key_code, is_pressed):
    """Send input event to server via HTTP POST"""
    try:
        data = json.dumps({
            'deviceId': 'input-bridge',
            'keyCode': key_code,
            'isPressed': is_pressed
        }).encode('utf-8')
        
        req = request.Request(
            f'{SERVER_URL}/api/input',
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        
        with request.urlopen(req, timeout=1) as response:
            pass
        
        print(f'[Input Bridge] Sent: keyCode={key_code}, isPressed={is_pressed}')
    except Exception as e:
        print(f'[Input Bridge] Error sending: {e}')

def monitor_buttons():
    """Monitor button events from event0"""
    print(f'[Input Bridge] Starting button monitor: {DEVICE_BUTTONS}')
    
    # Map hardware codes to virtual codes we send to server
    key_map = {
        KEY_ESC: KEY_BACK,      # Back button -> virtual BACK
        KEY_ENTER: KEY_ENTER,   # Dial click -> virtual ENTER  
        KEY_1: BTN_0,           # Preset 1
        KEY_2: BTN_1,           # Preset 2
        KEY_3: BTN_2,           # Preset 3
        KEY_4: BTN_3            # Preset 4
    }
    
    while True:
        try:
            with open(DEVICE_BUTTONS, 'rb') as f:
                while True:
                    event_data = f.read(EVENT_SIZE)
                    if len(event_data) < EVENT_SIZE:
                        break
                    
                    tv_sec, tv_usec, ev_type, code, value = struct.unpack(EVENT_FORMAT, event_data)
                    
                    print(f'[DEBUG] BUTTON event: type={ev_type:02x}, code={code:02x}, value={value}')
                    
                    if ev_type == EV_KEY and code in key_map:
                        # value: 0 = UP, 1 = DOWN, 2 = REPEAT
                        if value == 1:  # DOWN
                            send_input(key_map[code], True)
                        elif value == 0:  # UP
                            send_input(key_map[code], False)
        
        except Exception as e:
            print(f'[Input Bridge] Button monitor error: {e}')
        
        time.sleep(1)  # Retry delay

def monitor_dial():
    """Monitor dial rotation events from event1"""
    print(f'[Input Bridge] Starting dial monitor: {DEVICE_DIAL}')
    
    while True:
        try:
            with open(DEVICE_DIAL, 'rb') as f:
                while True:
                    event_data = f.read(EVENT_SIZE)
                    if len(event_data) < EVENT_SIZE:
                        break
                    
                    tv_sec, tv_usec, ev_type, code, value = struct.unpack(EVENT_FORMAT, event_data)
                    
                    print(f'[DEBUG] DIAL event: type={ev_type:02x}, code={code:02x}, value={value}')
                    
                    if ev_type == EV_REL and code == REL_DIAL:
                        # Convert to signed if needed (though car thing sends +1/-1 already)
                        if value > 0x7fffffff:
                            value = value - 0x100000000
                        
                        # Positive = clockwise = RIGHT, Negative = counter-clockwise = LEFT
                        if value > 0:
                            send_input(KEY_RIGHT, True)
                            time.sleep(0.01)
                            send_input(KEY_RIGHT, False)
                        elif value < 0:
                            send_input(KEY_LEFT, True)
                            time.sleep(0.01)
                            send_input(KEY_LEFT, False)
        
        except Exception as e:
            print(f'[Input Bridge] Dial monitor error: {e}')
        
        time.sleep(1)  # Retry delay

if __name__ == '__main__':
    print('[Input Bridge] Starting hardware input bridge...')
    
    # Start both monitors in separate threads
    button_thread = Thread(target=monitor_buttons, daemon=True)
    dial_thread = Thread(target=monitor_dial, daemon=True)
    
    button_thread.start()
    dial_thread.start()
    
    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print('[Input Bridge] Shutting down...')
