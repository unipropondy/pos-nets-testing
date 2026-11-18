-- ==============================================================================
-- SQL ROLLBACK SCRIPT: ROLLBACK 'NETS CARD' & 'NETS QR' PAYMODES
-- Database: Microsoft SQL Server
-- Target Table: dbo.Paymode
-- Author: Antigravity / Smart Cafe POS
-- ==============================================================================

-- Deactivate or remove only newly added NETS CARD and NETS QR paymodes
-- NEVER delete Position 2 (Legacy NETS) to safeguard historical data.

IF EXISTS (SELECT 1 FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(UPPER(PayMode))) = 'NETS CARD' AND Position >= 21)
BEGIN
    DELETE FROM [dbo].[Paymode]
    WHERE LTRIM(RTRIM(UPPER(PayMode))) = 'NETS CARD' AND Position >= 21;
    PRINT 'Rolled back NETS CARD paymode.';
END;

IF EXISTS (SELECT 1 FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(UPPER(PayMode))) = 'NETS QR' AND Position >= 21)
BEGIN
    DELETE FROM [dbo].[Paymode]
    WHERE LTRIM(RTRIM(UPPER(PayMode))) = 'NETS QR' AND Position >= 21;
    PRINT 'Rolled back NETS QR paymode.';
END;

-- Ensure Legacy NETS is active
UPDATE [dbo].[Paymode]
SET Active = 1
WHERE Position = 2;

PRINT 'Rollback completed successfully.';
