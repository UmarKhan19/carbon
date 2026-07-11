import { describe, expect, it } from "vitest";
import {
  buildQbwcSoapFault,
  buildQbwcSoapResponse,
  parseQbwcSoapRequest,
  QbwcSoapFaultError
} from "../soap";

/**
 * Golden tests for the QBWC SOAP layer — both directions. The incoming
 * fixtures mirror what the Web Connector actually sends (SOAP 1.1, default
 * xmlns http://developer.intuit.com/ on the operation element, load-bearing
 * parameter names).
 */

function envelope(body: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    `<soap:Body>${body}</soap:Body></soap:Envelope>`
  );
}

describe("parseQbwcSoapRequest", () => {
  it("parses authenticate with its credential parameters", () => {
    const request = parseQbwcSoapRequest(
      envelope(
        '<authenticate xmlns="http://developer.intuit.com/">' +
          "<strUserName>carbon-company-1</strUserName>" +
          "<strPassword>s3cret&amp;pass</strPassword>" +
          "</authenticate>"
      )
    );

    expect(request).toEqual({
      operation: "authenticate",
      params: {
        strUserName: "carbon-company-1",
        strPassword: "s3cret&pass"
      }
    });
  });

  it("parses sendRequestXML with the six QBWC parameters (versions stay strings)", () => {
    const request = parseQbwcSoapRequest(
      envelope(
        '<sendRequestXML xmlns="http://developer.intuit.com/">' +
          "<ticket>qbwc-1</ticket>" +
          "<strHCPResponse>&lt;?xml version=&quot;1.0&quot;?&gt;&lt;QBXML&gt;&lt;/QBXML&gt;</strHCPResponse>" +
          "<strCompanyFileName>C:\\QB\\acme.qbw</strCompanyFileName>" +
          "<qbXMLCountry>US</qbXMLCountry>" +
          "<qbXMLMajorVers>16</qbXMLMajorVers>" +
          "<qbXMLMinorVers>0</qbXMLMinorVers>" +
          "</sendRequestXML>"
      )
    );

    expect(request.operation).toBe("sendRequestXML");
    expect(request.params).toEqual({
      ticket: "qbwc-1",
      strHCPResponse: '<?xml version="1.0"?><QBXML></QBXML>',
      strCompanyFileName: "C:\\QB\\acme.qbw",
      qbXMLCountry: "US",
      qbXMLMajorVers: "16",
      qbXMLMinorVers: "0"
    });
  });

  it("parses receiveResponseXML and unescapes the embedded qbXML response", () => {
    const request = parseQbwcSoapRequest(
      envelope(
        '<receiveResponseXML xmlns="http://developer.intuit.com/">' +
          "<ticket>qbwc-1</ticket>" +
          "<response>&lt;QBXML&gt;&lt;QBXMLMsgsRs&gt;&lt;/QBXMLMsgsRs&gt;&lt;/QBXML&gt;</response>" +
          "<hresult></hresult>" +
          "<message></message>" +
          "</receiveResponseXML>"
      )
    );

    expect(request.operation).toBe("receiveResponseXML");
    expect(request.params).toEqual({
      ticket: "qbwc-1",
      response: "<QBXML><QBXMLMsgsRs></QBXMLMsgsRs></QBXML>",
      hresult: "",
      message: ""
    });
  });

  it("parses the remaining operations (self-closing and empty params read as empty strings)", () => {
    expect(parseQbwcSoapRequest(envelope("<serverVersion />"))).toEqual({
      operation: "serverVersion",
      params: {}
    });

    expect(
      parseQbwcSoapRequest(
        envelope(
          '<clientVersion xmlns="http://developer.intuit.com/"><strVersion>2.3.0.36</strVersion></clientVersion>'
        )
      )
    ).toEqual({
      operation: "clientVersion",
      params: { strVersion: "2.3.0.36" }
    });

    expect(
      parseQbwcSoapRequest(
        envelope(
          '<connectionError xmlns="http://developer.intuit.com/">' +
            "<ticket>qbwc-1</ticket><hresult>0x80040400</hresult><message>QuickBooks found an error</message>" +
            "</connectionError>"
        )
      )
    ).toEqual({
      operation: "connectionError",
      params: {
        ticket: "qbwc-1",
        hresult: "0x80040400",
        message: "QuickBooks found an error"
      }
    });

    expect(
      parseQbwcSoapRequest(
        envelope(
          '<getLastError xmlns="http://developer.intuit.com/"><ticket>qbwc-1</ticket></getLastError>'
        )
      )
    ).toEqual({ operation: "getLastError", params: { ticket: "qbwc-1" } });

    expect(
      parseQbwcSoapRequest(
        envelope(
          '<closeConnection xmlns="http://developer.intuit.com/"><ticket>qbwc-1</ticket></closeConnection>'
        )
      )
    ).toEqual({ operation: "closeConnection", params: { ticket: "qbwc-1" } });
  });

  it("throws a Client fault for unknown operations and malformed envelopes", () => {
    expect(() =>
      parseQbwcSoapRequest(
        envelope("<interactiveDone><ticket>t</ticket></interactiveDone>")
      )
    ).toThrowError(QbwcSoapFaultError);
    expect(() => parseQbwcSoapRequest(envelope("<interactiveDone />"))).toThrow(
      /Unknown QBWC operation: interactiveDone/
    );

    expect(() => parseQbwcSoapRequest("<not-soap/>")).toThrow(
      /missing <soap:Body>/
    );
  });
});

describe("buildQbwcSoapResponse", () => {
  it("renders string-array results as <string> children (authenticate golden)", () => {
    expect(buildQbwcSoapResponse("authenticate", ["qbwc-1", ""])).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
        '<soap:Body><authenticateResponse xmlns="http://developer.intuit.com/">' +
        "<authenticateResult><string>qbwc-1</string><string></string></authenticateResult>" +
        "</authenticateResponse></soap:Body></soap:Envelope>"
    );
  });

  it("renders string results as escaped text (sendRequestXML golden)", () => {
    expect(
      buildQbwcSoapResponse(
        "sendRequestXML",
        '<?xml version="1.0" encoding="utf-8"?>\n<?qbxml version="16.0"?>\n<QBXML><QBXMLMsgsRq onError="continueOnError"></QBXMLMsgsRq></QBXML>'
      )
    ).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
        '<soap:Body><sendRequestXMLResponse xmlns="http://developer.intuit.com/">' +
        "<sendRequestXMLResult>&lt;?xml version=&quot;1.0&quot; encoding=&quot;utf-8&quot;?&gt;\n&lt;?qbxml version=&quot;16.0&quot;?&gt;\n&lt;QBXML&gt;&lt;QBXMLMsgsRq onError=&quot;continueOnError&quot;&gt;&lt;/QBXMLMsgsRq&gt;&lt;/QBXML&gt;</sendRequestXMLResult>" +
        "</sendRequestXMLResponse></soap:Body></soap:Envelope>"
    );
  });

  it("renders int results as bare text (receiveResponseXML golden)", () => {
    expect(buildQbwcSoapResponse("receiveResponseXML", 100)).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
        '<soap:Body><receiveResponseXMLResponse xmlns="http://developer.intuit.com/">' +
        "<receiveResponseXMLResult>100</receiveResponseXMLResult>" +
        "</receiveResponseXMLResponse></soap:Body></soap:Envelope>"
    );
    expect(buildQbwcSoapResponse("receiveResponseXML", -1)).toContain(
      "<receiveResponseXMLResult>-1</receiveResponseXMLResult>"
    );
  });
});

describe("buildQbwcSoapFault", () => {
  it("builds the SOAP Fault envelope (golden)", () => {
    expect(buildQbwcSoapFault("Client", "Unknown QBWC operation: <foo>")).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
        "<soap:Body><soap:Fault>" +
        "<faultcode>soap:Client</faultcode>" +
        "<faultstring>Unknown QBWC operation: &lt;foo&gt;</faultstring>" +
        "</soap:Fault></soap:Body></soap:Envelope>"
    );
  });
});
