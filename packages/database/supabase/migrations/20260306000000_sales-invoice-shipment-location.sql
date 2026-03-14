CREATE OR REPLACE VIEW "salesInvoiceLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT
    si.id,
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."stateProvince" AS "customerStateProvince",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode",
    cc."name" AS "customerCountryName",
    ic.name AS "invoiceCustomerName",
    ica."addressLine1" AS "invoiceAddressLine1",
    ica."addressLine2" AS "invoiceAddressLine2",
    ica."city" AS "invoiceCity",
    ica."stateProvince" AS "invoiceStateProvince",
    ica."postalCode" AS "invoicePostalCode",
    ica."countryCode" AS "invoiceCountryCode",
    icc."name" AS "invoiceCountryName",
    sc.name AS "shipmentCustomerName",
    sa."addressLine1" AS "shipmentAddressLine1",
    sa."addressLine2" AS "shipmentAddressLine2",
    sa."city" AS "shipmentCity",
    sa."stateProvince" AS "shipmentStateProvince",
    sa."postalCode" AS "shipmentPostalCode",
    sa."countryCode" AS "shipmentCountryCode",
    scc."name" AS "shipmentCountryName"
  FROM "salesInvoice" si
  INNER JOIN "customer" c
    ON c.id = si."customerId"
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = si."locationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId"
  LEFT OUTER JOIN "country" cc
    ON cc.alpha2 = ca."countryCode"
  LEFT OUTER JOIN "customer" ic
    ON ic.id = si."invoiceCustomerId"
  LEFT OUTER JOIN "customerLocation" icl
    ON icl.id = si."invoiceCustomerLocationId"
  LEFT OUTER JOIN "address" ica
    ON ica.id = icl."addressId"
  LEFT OUTER JOIN "country" icc
    ON icc.alpha2 = ica."countryCode"
  LEFT OUTER JOIN "salesInvoiceShipment" sis
    ON sis.id = si.id
  LEFT OUTER JOIN "customerLocation" scl
    ON scl.id = sis."locationId"
  LEFT OUTER JOIN "address" sa
    ON sa.id = scl."addressId"
  LEFT OUTER JOIN "country" scc
    ON scc.alpha2 = sa."countryCode"
  LEFT OUTER JOIN "customer" sc
    ON sc.id = scl."customerId";
