# Staff password blocklist v1

The staff-only blocklist derives from the first 100,000 entries of the public SecLists Xato common-password dataset. Only the 70 entries within the permitted 15–128 character length range are retained, as deduplicated SHA-256 hashes of lowercase UTF-8 values. The staff password itself is never normalized before Argon2 hashing. Shorter common passwords already fail the length policy. Additional local trivial/example passphrases and repeated-character passwords are denied.

Source: https://github.com/danielmiessler/SecLists/blob/c205c36a445bff37f8e58a9ec829105cd4975c58/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt

Retrieved: 2026-10-07. Upstream source SHA-256: `1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b`.

Generated JSON SHA-256 (Windows CRLF): `2f91d47e4e7e654bb5729218b5b52fbc8d41a9ef79ab9e42fb1ed4c3d0a2a459`.

License: SecLists MIT, copyright Daniel Miessler 2018; included verbatim in `staff-password-blocklist-LICENSE.txt`.

Maintenance: review upstream quarterly and during authentication releases. Download a pinned revision from the public source, verify and record its hash, filter to 15–128 Unicode code points, lowercase only for blocklist lookup, hash UTF-8 with SHA-256, deduplicate and sort hashes, replace `src/modules/identity/infrastructure/staff-common-passwords.json`, update this provenance and the source license, and rerun policy/authentication tests. This version's eligible source entries contain no surrogate pairs, so the generated character-length filter matches code-point lengths.

This is a local common-password check, not a comprehensive breach lookup. Passwords are never sent to an external service. Customer policy and stored customer hashes remain unchanged.
