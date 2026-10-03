// Answers a `Range: bytes=…` request from a complete cached response. The
// <audio> element asks for the theme in ranges, and Safari refuses to play
// media that comes back as a plain 200 with the whole file instead of a 206.
export const makeRangeResponse = async (rangeHeader, fullResponse) => {
  const body = await fullResponse.arrayBuffer();
  const size = body.byteLength;
  const contentType = fullResponse.headers.get("Content-Type");
  const headers = contentType ? { "Content-Type": contentType } : {};

  // Multi-range and malformed headers fall back to the whole file, which a
  // server is also allowed to do
  const match = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader || "").trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    return new Response(body, { status: 200, headers });
  }

  let start;
  let end;
  if (match[1] === "") {
    // Suffix range: the last n bytes
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
};
