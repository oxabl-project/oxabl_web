/* order-totals.i
   Shared constants and result tables for the fulfillment programs. */

&SCOPED-DEFINE MAX-BACKORDER-DAYS 14
&SCOPED-DEFINE HIGH-VALUE-THRESHOLD 5000.00

/* One row per order that is ready to ship. */
DEFINE TEMP-TABLE ttOrderSummary NO-UNDO
    FIELD Ordernum     AS INTEGER
    FIELD CustNum      AS INTEGER
    FIELD CustomerName AS CHARACTER
    FIELD LineCount    AS INTEGER
    FIELD GrossTotal   AS DECIMAL
    FIELD NetTotal     AS DECIMAL
    FIELD HasBackorder AS LOGICAL
    INDEX idxOrder IS PRIMARY UNIQUE Ordernum
    INDEX idxCustomer CustNum Ordernum.

/* One row per item that has fallen below its reorder level. */
DEFINE TEMP-TABLE ttRestockAlert NO-UNDO
    FIELD Itemnum   AS INTEGER
    FIELD ItemName  AS CHARACTER
    FIELD Onhand    AS INTEGER
    FIELD Allocated AS INTEGER
    FIELD Shortfall AS INTEGER
    INDEX idxItem IS PRIMARY UNIQUE Itemnum.
