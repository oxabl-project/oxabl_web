/* order-fulfillment.p
   Nightly fulfillment run over the Sports2000 sample database.

   Builds order summaries, flags customers by phone prefix, reprices one open
   order, audits one country and reports items that need restocking. Hover a
   name, press F12 on it, or type "Customer." and press Ctrl+Space. */

BLOCK-LEVEL ON ERROR UNDO, THROW.

{order-totals.i}

DEFINE VARIABLE iOrderCount  AS INTEGER   NO-UNDO.
DEFINE VARIABLE dRunTotal    AS DECIMAL   NO-UNDO.
DEFINE VARIABLE cAreaCode    AS CHARACTER NO-UNDO INITIAL "603".
DEFINE VARIABLE cCountry     AS CHARACTER NO-UNDO INITIAL "USA".
DEFINE VARIABLE iTargetOrder AS INTEGER   NO-UNDO INITIAL 1.

FUNCTION calcLineNet RETURNS DECIMAL (INPUT pdPrice AS DECIMAL, INPUT piQty AS INTEGER, INPUT piDiscount AS INTEGER) FORWARD.

/* ------------------------------------------------------------------ */
/* Main block                                                          */
/* ------------------------------------------------------------------ */

RUN buildOrderSummaries.
RUN flagPhoneRegionCustomers (INPUT cAreaCode).
RUN repriceOpenOrder (INPUT iTargetOrder).
RUN auditCustomerOrders (INPUT cCountry).
RUN summarizeInventory (INPUT iTargetOrder).

FOR EACH ttOrderSummary:
    iOrderCount = iOrderCount + 1.
    dRunTotal   = dRunTotal + ttOrderSummary.NetTotal.
    IF ttOrderSummary.NetTotal > DECIMAL("{&HIGH-VALUE-THRESHOLD}") THEN
        MESSAGE "High value order" ttOrderSummary.Ordernum
            ttOrderSummary.CustomerName.
END.

MESSAGE iOrderCount "orders, net total" dRunTotal.

/* ------------------------------------------------------------------ */
/* Order summaries                                                     */
/* ------------------------------------------------------------------ */

PROCEDURE buildOrderSummaries:
    DEFINE VARIABLE dLineNet AS DECIMAL NO-UNDO.

    EMPTY TEMP-TABLE ttOrderSummary.

    FOR EACH Order WHERE Order.OrderStatus = "Ordered" NO-LOCK,
        EACH OrderLine WHERE OrderLine.Ordernum = Order.Ordernum NO-LOCK:
        /* One lookup per order line: the linter flags a FIND in a loop. */
        FIND FIRST Item WHERE Item.Itemnum = OrderLine.Itemnum
            NO-LOCK NO-ERROR.

        dLineNet = calcLineNet(OrderLine.Price, OrderLine.Qty,
                               OrderLine.Discount).

        FIND ttOrderSummary WHERE ttOrderSummary.Ordernum = Order.Ordernum
            NO-ERROR.
        IF NOT AVAILABLE ttOrderSummary THEN DO:
            CREATE ttOrderSummary.
            ASSIGN
                ttOrderSummary.Ordernum = Order.Ordernum
                ttOrderSummary.CustNum  = Order.CustNum.
        END.

        ASSIGN
            ttOrderSummary.LineCount  = ttOrderSummary.LineCount + 1
            ttOrderSummary.GrossTotal = ttOrderSummary.GrossTotal
                                        + (OrderLine.Price * OrderLine.Qty)
            ttOrderSummary.NetTotal   = ttOrderSummary.NetTotal + dLineNet.

        IF AVAILABLE Item AND Item.Onhand < OrderLine.Qty THEN
            ttOrderSummary.HasBackorder = TRUE.
    END.
END PROCEDURE.

/* ------------------------------------------------------------------ */
/* Customers by phone prefix                                           */
/* ------------------------------------------------------------------ */

PROCEDURE flagPhoneRegionCustomers:
    DEFINE INPUT PARAMETER pcAreaCode AS CHARACTER NO-UNDO.

    DEFINE VARIABLE iOpenOrders AS INTEGER NO-UNDO.

    /* Phone has no index, so this search reads the whole table. */
    FOR EACH Customer WHERE Customer.Phone BEGINS pcAreaCode NO-LOCK:
        /* RegionCode is not a Customer field in this schema. */
        IF Customer.RegionCode = "" THEN
            NEXT.

        /* No lock phrase, so the record is read with the default lock. */
        FIND FIRST Order WHERE Order.CustNum = Customer.CustNum NO-ERROR.
        IF AVAILABLE Order THEN
            iOpenOrders = iOpenOrders + 1.
    END.

    MESSAGE iOpenOrders "customers with orders in area" pcAreaCode.
END PROCEDURE.

/* ------------------------------------------------------------------ */
/* Repricing                                                           */
/* ------------------------------------------------------------------ */

PROCEDURE repriceOpenOrder:
    DEFINE INPUT PARAMETER piOrderNum AS INTEGER NO-UNDO.

    /* No NO-UNDO, so this variable is rolled back with the transaction. */
    DEFINE VARIABLE iAdjustedLines AS INTEGER.
    DEFINE VARIABLE dLegacyTaxRate AS DECIMAL NO-UNDO.

    /* The update has no explicit transaction block, so each pass of the
       loop opens one. */
    FOR EACH OrderLine WHERE OrderLine.Ordernum = piOrderNum EXCLUSIVE-LOCK:
        OrderLine.ExtendedPrice = calcLineNet(OrderLine.Price,
                                              OrderLine.Qty,
                                              OrderLine.Discount).
        iAdjustedLines = iAdjustedLines + 1.
    END.

    MESSAGE iAdjustedLines "lines repriced on order" piOrderNum.
END PROCEDURE.

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

PROCEDURE auditCustomerOrders:
    DEFINE INPUT PARAMETER pcCountry AS CHARACTER NO-UNDO.

    DEFINE VARIABLE iCustomers AS INTEGER NO-UNDO.

    FOR EACH Customer WHERE Customer.Country = pcCountry NO-LOCK:
        iCustomers = iCustomers + 1.
    END.

    /* The Customer buffer is still in scope here, which is rarely intended. */
    MESSAGE iCustomers "customers in" pcCountry ", last was" Customer.Name.
END PROCEDURE.

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

PROCEDURE summarizeInventory:
    DEFINE INPUT PARAMETER piOrderNum AS INTEGER NO-UNDO.

    DEFINE BUFFER bOrder FOR Order.

    EMPTY TEMP-TABLE ttRestockAlert.

    FOR EACH Item WHERE Item.Onhand < Item.ReOrder NO-LOCK:
        CREATE ttRestockAlert.
        ASSIGN
            ttRestockAlert.Itemnum   = Item.Itemnum
            ttRestockAlert.ItemName  = Item.ItemName
            ttRestockAlert.Onhand    = Item.Onhand
            ttRestockAlert.Allocated = Item.Allocated
            ttRestockAlert.Shortfall = Item.ReOrder - Item.Onhand.
    END.

    DO TRANSACTION:
        FIND bOrder WHERE bOrder.Ordernum = piOrderNum
            EXCLUSIVE-LOCK NO-ERROR.
        IF AVAILABLE bOrder THEN
            bOrder.OrderStatus = "Shipped".
    END.
END PROCEDURE.

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

FUNCTION calcLineNet RETURNS DECIMAL
    (INPUT pdPrice    AS DECIMAL,
     INPUT piQty      AS INTEGER,
     INPUT piDiscount AS INTEGER):
    DEFINE VARIABLE dGross    AS DECIMAL NO-UNDO.
    DEFINE VARIABLE dDiscount AS DECIMAL NO-UNDO.

    dGross    = pdPrice * piQty.
    dDiscount = dGross * piDiscount / 100.

    RETURN ROUND(dGross - dDiscount, 2).
END FUNCTION.
