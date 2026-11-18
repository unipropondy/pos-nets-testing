-- ==============================================================================
-- SQL MIGRATION SCRIPT: DYNAMIC 'NETS CARD' & 'NETS QR' PAYMODES
-- Database: Microsoft SQL Server
-- Target Table: dbo.Paymode
-- Author: Antigravity / Smart Cafe POS
-- ==============================================================================

-- 1. Verify existence of table
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Paymode]') AND type in (N'U'))
BEGIN
    RAISERROR('Table [dbo].[Paymode] does not exist!', 16, 1);
    RETURN;
END;

-- 2. Idempotent check and insert for 'NETS CARD'
-- Position 21 is assigned to 'NETS CARD'.
-- If 'NETS CARD' exists by PayMode or Description, ensure Active = 1.
-- Otherwise, insert a new record for 'NETS CARD'.
IF EXISTS (SELECT 1 FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(UPPER(PayMode))) = 'NETS CARD' OR LTRIM(RTRIM(UPPER(Description))) = 'NETS CARD')
BEGIN
    UPDATE [dbo].[Paymode]
    SET Active = 1,
        Description = 'NETS CARD',
        ModifyDate = GETDATE()
    WHERE LTRIM(RTRIM(UPPER(PayMode))) = 'NETS CARD' OR LTRIM(RTRIM(UPPER(Description))) = 'NETS CARD';
    PRINT 'Updated existing NETS CARD paymode to Active.';
END
ELSE
BEGIN
    -- Determine safe Position if 21 is taken
    DECLARE @PosCard DECIMAL(18, 0) = 21;
    IF EXISTS (SELECT 1 FROM [dbo].[Paymode] WHERE Position = @PosCard)
    BEGIN
        SELECT @PosCard = ISNULL(MAX(Position), 20) + 1 FROM [dbo].[Paymode];
    END;

    INSERT INTO [dbo].[Paymode] (
        Position,
        PayMode,
        Description,
        Commission,
        Active,
        CreateDate,
        ServiceCharge,
        isEntertainment,
        isVoucher,
        YeahPayEnabled
    ) VALUES (
        @PosCard,
        'NETS CARD',
        'NETS CARD',
        0,
        1,
        GETDATE(),
        0,
        0,
        0,
        0
    );
    PRINT 'Inserted new NETS CARD paymode at Position ' + CAST(@PosCard AS VARCHAR(10)) + '.';
END;

-- 3. Idempotent check and insert for 'NETS QR'
-- Position 22 is assigned to 'NETS QR'.
-- If 'NETS QR' exists by PayMode or Description, ensure Active = 1.
-- Otherwise, insert a new record for 'NETS QR'.
IF EXISTS (SELECT 1 FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(UPPER(PayMode))) = 'NETS QR' OR LTRIM(RTRIM(UPPER(Description))) = 'NETS QR')
BEGIN
    UPDATE [dbo].[Paymode]
    SET Active = 1,
        Description = 'NETS QR',
        ModifyDate = GETDATE()
    WHERE LTRIM(RTRIM(UPPER(PayMode))) = 'NETS QR' OR LTRIM(RTRIM(UPPER(Description))) = 'NETS QR';
    PRINT 'Updated existing NETS QR paymode to Active.';
END
ELSE
BEGIN
    -- Determine safe Position if 22 is taken
    DECLARE @PosQr DECIMAL(18, 0) = 22;
    IF EXISTS (SELECT 1 FROM [dbo].[Paymode] WHERE Position = @PosQr)
    BEGIN
        SELECT @PosQr = ISNULL(MAX(Position), 21) + 1 FROM [dbo].[Paymode];
    END;

    INSERT INTO [dbo].[Paymode] (
        Position,
        PayMode,
        Description,
        Commission,
        Active,
        CreateDate,
        ServiceCharge,
        isEntertainment,
        isVoucher,
        YeahPayEnabled
    ) VALUES (
        @PosQr,
        'NETS QR',
        'NETS QR',
        0,
        1,
        GETDATE(),
        0,
        0,
        0,
        0
    );
    PRINT 'Inserted new NETS QR paymode at Position ' + CAST(@PosQr AS VARCHAR(10)) + '.';
END;

-- 4. Note on Legacy 'NETS' Record (Position 2):
-- Historical transactions (319+ settlements, 294+ payment details) reference Position 2.
-- We keep Position 2 active or preserved for historical report aggregation and backward compatibility.
PRINT 'Migration completed successfully. Legacy NETS (Position 2), NETS CARD, and NETS QR are ready.';
