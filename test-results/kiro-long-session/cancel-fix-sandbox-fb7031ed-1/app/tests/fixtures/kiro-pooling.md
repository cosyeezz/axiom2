# Local Kiro connection-pool fixture

`kiro-pooling-key.pem` is a **public test-only private key**, paired with the self-signed `kiro-pooling-cert.pem` for `localhost`, `127.0.0.1`, and `pool-fixture.invalid`. It is not an account credential and must never be used outside this fixture. The certificate is valid for ten years from generation.

The parent test launches a fresh Node process with this certificate in `NODE_EXTRA_CA_CERTS`. It does not disable TLS verification, alter system trust, or modify the parent's proxy/dispatcher/trust configuration. All servers bind to `127.0.0.1`; the fake hostname is handled by a local CONNECT proxy which pins forwarding to the local TLS server. No real Kiro endpoint, credential store, or DNS target is used.

The fixture tests the production network initializer and native chat/catalog body readers. A 4.6-second idle gap reproduces the old HTTP/1.1 four-second default. Kiro direct/proxy and HTTP/2 now retain one TLS connection across that gap; another provider keeps its default behavior. Shorter peer keep-alive hints, close/GOAWAY, NoProxy, and a rejected CONNECT remain effective. This is not a measurement of live Kiro latency or an assurance that any remote socket lasts 60 seconds.
