# Lume Browser bridge protocol

The Native Host maintains one full-duplex newline-delimited JSON connection to
the configured current-user named pipe on Windows or Unix socket on macOS. The
non-secret configuration contains `pairingId`, `generation`, `pipeEndpoint`, and
the Native Host path. The 32-byte pairing key is stored in Windows Credential
Manager or macOS Keychain and is never written to either configuration file.

## Authenticated handshake

1. Lume sends `app.challenge` containing protocol version, pairing ID,
   generation, and a fresh `nonceMain`.
2. The Host verifies pairing ID/generation, creates `nonceHost`, and returns
   `app.hello` with its build version and
   `HMAC(Kpair, "host\n" || transcript)`.
3. Lume verifies the Host proof and returns
   `HMAC(Kpair, "main\n" || transcript)`.
4. Both sides derive a 32-byte session key using HKDF-SHA256 with both nonces and
   the fixed `lume-browser-bridge-v1` context.

Any mismatch closes the connection. Re-pairing changes the generation and key,
so a Host using old state cannot authenticate.

## Authenticated frames

After the handshake every line is an envelope:

```json
{"sequence":1,"payload":"<base64url JSON>","mac":"<base64url HMAC-SHA256>"}
```

The MAC covers the unsigned 64-bit big-endian sequence followed by the exact
payload bytes. Each direction starts at sequence 1 and accepts only the next
value, rejecting replay, gaps, malformed payloads, and modified MACs before JSON
dispatch.

The decoded payload is the existing Browser JSON-RPC request or response. Local
Native Host methods (`host.hello`, `host.ping`, and `host.asset.*`) remain on the
Chrome Native Messaging side and are not forwarded to Lume.
