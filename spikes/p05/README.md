# P05 device benchmark

Follow the [physical Android checklist](MANUAL-QA.md) for setup, test cases, pass criteria, cleanup, and the sign-off record.

The benchmark uses the production native adapters from the normal debug build. It runs only through the explicit development launcher, and its files stay outside the normal app and release graph. All fixtures are synthetic. Harness logs contain aggregate numbers, booleans and fixed phase or reason codes.
