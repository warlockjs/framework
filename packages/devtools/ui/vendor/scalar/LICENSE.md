# Scalar API Reference (vendored)

`standalone.js` is the unmodified prebuilt browser bundle of
[`@scalar/api-reference`](https://github.com/scalar/scalar) **1.72.2**
(`dist/browser/standalone.js` in the npm package), vendored so apps that add
`@warlock.js/devtools` install nothing extra. It is served only by the
devtools API docs page (`/__warlock/docs`), in development, to loopback clients.

To update: `npm pack @scalar/api-reference@<version>`, extract
`package/dist/browser/standalone.js` over this file, and update the version above.

## License

MIT License

Copyright (c) Scalar (https://github.com/scalar)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
