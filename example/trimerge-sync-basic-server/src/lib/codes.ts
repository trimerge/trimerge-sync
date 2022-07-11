/** Normal Closure	Normal closure; the connection successfully completed whatever purpose for which it was created.*/
export const NormalClose = 1000;
/** Going Away	The endpoint is going away, either because of a server failure or because the browser is navigating away from the page that opened the connection.*/
export const GoingAway = 1001;
/** Protocol Error	The endpoint is terminating the connection due to a protocol error.*/
export const ProtocolError = 1002;
/** Unsupported Data	The connection is being terminated because the endpoint received data of a type it cannot accept (for example, a text-only endpoint received binary data).*/
export const UnsupportedData = 1003;
/** 	Reserved. A meaning might be defined in the future.*/
// export const Reserved = 1004;
/** No Status Received	Reserved.  Indicates that no status code was provided even though one was expected.*/
export const NoStatusReceived = 1005;
/** Abnormal Closure	Reserved. Used to indicate that a connection was closed abnormally (that is, with no close frame being sent) when a status code is expected.*/
export const AbnormalClosure = 1006;
/** Invalid frame payload data	The endpoint is terminating the connection because a message was received that contained inconsistent data (e.g., non-UTF-8 data within a text message).*/
export const InvalidFramePayloadData = 1007;
/** Policy Violation	The endpoint is terminating the connection because it received a message that violates its policy. This is a generic status code, used when codes 1003 and 1009 are not suitable.*/
export const PolicyViolation = 1008;
/** Message too big	The endpoint is terminating the connection because a data frame was received that is too large.*/
export const MessageTooBig = 1009;
/** Missing Extension	The client is terminating the connection because it expected the server to negotiate one or more extension, but the server didn't.*/
export const MissingExtension = 1010;
/** Internal Error	The server is terminating the connection because it encountered an unexpected condition that prevented it from fulfilling the request.*/
export const InternalError = 1011;
/** Service Restart	The server is terminating the connection because it is restarting. [Ref]*/
export const ServiceRestart = 1012;
/** Try Again Later	The server is terminating the connection due to a temporary condition, e.g. it is overloaded and is casting off some of its clients. [Ref]*/
export const TryAgainLater = 1013;
/** Bad Gateway	The server was acting as a gateway or proxy and received an invalid response from the upstream server. This is similar to 502 HTTP Status Code.*/
export const BadGateway = 1014;
/** TLS Handshake	Reserved. Indicates that the connection was closed due to a failure to perform a TLS handshake (e.g., the server certificate can't be verified).*/
export const TlsHandshake = 1015;
// export const X = 1016–1999		Reserved for future use by the WebSocket standard.
// export const X = 2000–2999		Reserved for use by WebSocket extensions.
// export const X = 3000–3999		Available for use by libraries and frameworks. May not be used by applications. Available for registration at the IANA via first-come, first-serve.
// export const X = 4000–4999		Available for use by applications.
