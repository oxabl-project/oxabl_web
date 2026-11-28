/* credit-check.p
   Lists customers whose balance is over their credit limit.

   This file has one deliberate syntax error, so you can see what the parser
   reports and how the rest of the file is still analysed. */

DEFINE VARIABLE dUnusedLimit AS DECIMAL NO-UNDO.
DEFINE VARIABLE iOverLimit   AS INTEGER NO-UNDO.

FOR EACH Customer NO-LOCK:
    /* The THEN is missing from the next line. */
    IF Customer.Balance > Customer.CreditLimit
    DO:
        iOverLimit = iOverLimit + 1.
        DISPLAY Customer.CustNum Customer.Name Customer.Balance.
    END.
END.

MESSAGE iOverLimit "customers are over their credit limit."
    VIEW-AS ALERT-BOX INFORMATION.
