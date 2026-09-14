---
"agslint": minor
---

Report the coreloss / cavity / wash boring intervals read from `CORE_REM` under a
new `AGS3-DATA-5` check.

The four existing `AGS3-DATA-*` checks only speak up when something is wrong with
a remark, so a reviewer had no way to see how a remark that passed was actually
read. `AGS3-DATA-5` states the reading at `information` severity -- one message
per marker per row, listing every range and their total:

    CORE_REM records core loss at 10.80-11.00m (0.20m).
    CORE_REM records cavity at 10.20-10.60m, 10.70-10.80m (0.50m in total).
    CORE_REM records wash boring at 10.20-10.60m (0.40m).

These are the depths the other four checks -- and AGS Extractor's layer splitting
-- act on, so a transposed or out-of-run range is shown alongside the warning as
the depths it was read as. A marker with no readable range still gets
`AGS3-DATA-4` and no `AGS3-DATA-5`: there is nothing to report the reading of.
