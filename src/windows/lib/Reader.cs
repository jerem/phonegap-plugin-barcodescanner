/*
 * Copyright (c) Microsoft Open Technologies, Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

namespace WinRTBarcodeReader
{
    using System;
    using System.Threading;
    using System.Threading.Tasks;

    using Windows.Foundation;
    using Windows.Graphics.Imaging;
    //using Windows.Media.Capture;
    //using Windows.Media.MediaProperties;
    using Windows.Storage.Streams;

    using ZXing;

    /// <summary>
    /// Defines the Reader type, that perform barcode search asynchronously.
    /// </summary>
    public sealed class Reader
    {
        #region Private fields

        /// <summary>
        ///     Data reader, used to create bitmap array.
        /// </summary>
        private BarcodeReader barcodeReader;

        #endregion

        #region Constructor

        /// <summary>
        /// Initializes a new instance of the <see cref="Reader" /> class.
        /// </summary>
        public void Init()
        {
            barcodeReader = new BarcodeReader {Options = {TryHarder = true}};
        }

        #endregion

        #region Public methods

        /// <summary>
        /// Perform async MediaCapture analysis and searches for barcode.
        /// </summary>
        /// <returns>IAsyncOperation object</returns>
        public IAsyncOperation<Result> ReadCode(String base64string)
        {
            return this.Read(base64string).AsAsyncOperation();
        }

        #endregion

        #region Private methods

        /// <summary>
        /// Perform async MediaCapture analysis and searches for barcode.
        /// </summary>
        /// <returns>Task object</returns>
        private async Task<Result> Read(String base64string)
        {
            return await GetCodeFromImage(base64string);
        }

        private async Task<Result> GetCodeFromImage(String base64string)
        {
            var imageBytes = Convert.FromBase64String(base64string);
            using (InMemoryRandomAccessStream ms = new InMemoryRandomAccessStream())
            {
                using (DataWriter writer = new DataWriter(ms.GetOutputStreamAt(0)))
                {
                    writer.WriteBytes((byte[])imageBytes);
                    writer.StoreAsync().GetResults();
                }

                var decoder = await BitmapDecoder.CreateAsync(ms);

                byte[] pixels =
                    (await
                        decoder.GetPixelDataAsync(BitmapPixelFormat.Rgba8,
                            BitmapAlphaMode.Ignore,
                            new BitmapTransform(),
                            ExifOrientationMode.IgnoreExifOrientation,
                            ColorManagementMode.DoNotColorManage)).DetachPixelData();

                const BitmapFormat format = BitmapFormat.RGB32;

                var result =
                    await
                        Task.Run(
                            () => barcodeReader.Decode(pixels, (int)decoder.PixelWidth, (int)decoder.PixelHeight, format)
                        );

                return result;
            }
        }

        #endregion
    }
}
