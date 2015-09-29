(function () {
    "use strict";

    var Capture = Windows.Media.Capture;
    var DeviceInformation = Windows.Devices.Enumeration.DeviceInformation;
    var DeviceClass = Windows.Devices.Enumeration.DeviceClass;
    var DisplayOrientations = Windows.Graphics.Display.DisplayOrientations;
    var Imaging = Windows.Graphics.Imaging;
    var Media = Windows.Media;

    // Receive notifications about rotation of the device and UI and apply any necessary rotation to the preview stream and UI controls
    var oDisplayInformation = Windows.Graphics.Display.DisplayInformation.getForCurrentView(),
        oDisplayOrientation = oDisplayInformation.currentOrientation;

    // Prevent the screen from sleeping while the camera is running
    var oDisplayRequest = new Windows.System.Display.DisplayRequest();

    // For listening to media property changes
    var oSystemMediaControls = Media.SystemMediaTransportControls.getForCurrentView();

    // MediaCapture and its state variables
    var oMediaCapture = null,
        isInitialized = false,
        isPreviewing = false;

    // Information about the camera device
    var externalCamera = false,
        mirroringPreview = false;

    // Rotation metadata to apply to the preview stream and recorded videos (MF_MT_VIDEO_ROTATION)
    // Reference: http://msdn.microsoft.com/en-us/library/windows/apps/xaml/hh868174.aspx
    var RotationKey = "C380465D-2271-428C-9B83-ECEA3B4A85C1";

    /// <summary>
    /// Initializes the MediaCapture, registers events, gets camera device information for mirroring and rotating, starts preview and unlocks the UI
    /// </summary>
    /// <returns></returns>
    function initializeCameraAsync() {
        console.log("InitializeCameraAsync");

        // Get available devices for capturing pictures
        return findCameraDeviceByPanelAsync(Windows.Devices.Enumeration.Panel.back)
        .then(function (camera) {
            if (!camera) {
                console.log("No camera device found!");
                return;
            }
            // Figure out where the camera is located
            if (!camera.enclosureLocation || camera.enclosureLocation.panel === Windows.Devices.Enumeration.Panel.unknown) {
                // No information on the location of the camera, assume it's an external camera, not integrated on the device
                externalCamera = true;
            }
            else {
                // Camera is fixed on the device
                externalCamera = false;

                // Only mirror the preview if the camera is on the front panel
                mirroringPreview = (camera.enclosureLocation.panel === Windows.Devices.Enumeration.Panel.front);
            }

            oMediaCapture = new Capture.MediaCapture();

            // Register for a notification when something goes wrong
            oMediaCapture.addEventListener("failed", mediaCapture_failed);

            var settings = new Capture.MediaCaptureInitializationSettings();
            settings.videoDeviceId = camera.id;
            settings.streamingCaptureMode = Windows.Media.Capture.StreamingCaptureMode.video;

            // Initialize media capture and start the preview
            return oMediaCapture.initializeAsync(settings);
        }).then(function () {
            isInitialized = true;
            return startPreviewAsync();
        }, function (error) {
            console.log(error.message);
        }).done();
    }

    /// <summary>
    /// Cleans up the camera resources (after stopping any video recording and/or preview if necessary) and unregisters from MediaCapture events
    /// </summary>
    /// <returns></returns>
    function cleanupCameraAsync() {
        console.log("cleanupCameraAsync");

        var promiseList = {};

        if (isInitialized) {
            if (isPreviewing) {
                // The call to stop the preview is included here for completeness, but can be
                // safely removed if a call to MediaCapture.close() is being made later,
                // as the preview will be automatically stopped at that point
                stopPreview();
            }

            isInitialized = false;
        }

        // When all our tasks complete, clean up MediaCapture
        return WinJS.Promise.join(promiseList)
        .then(function () {
            if (oMediaCapture != null) {
                oMediaCapture.removeEventListener("failed", mediaCapture_failed);
                oMediaCapture.close();
                oMediaCapture = null;
            }
        });
    }

    /// <summary>
    /// Starts the preview and adjusts it for for rotation and mirroring after making a request to keep the screen on
    /// </summary>
    function startPreviewAsync() {
        // Prevent the device from sleeping while the preview is running
        oDisplayRequest.requestActive();

        // Register to listen for media property changes
        oSystemMediaControls.addEventListener("propertychanged", systemMediaControls_PropertyChanged);

        // Set the preview source in the UI and mirror it if necessary
        var cameraWrapper = document.getElementById("cameraWrapper");
        if (mirroringPreview) {
            cameraWrapper.style.transform = "scale(-1, 1)";
        }

        var previewVidTag = document.getElementById("cameraPreview");
        var previewUrl = URL.createObjectURL(oMediaCapture);
        previewVidTag.src = previewUrl;
        previewVidTag.play();

        previewVidTag.addEventListener("playing", function () {
            isPreviewing = true;
            oDisplayOrientation = Windows.Graphics.Display.DisplayInformation.getForCurrentView().currentOrientation;
            setPreviewRotation();
        });
    }

    /// <summary>
    /// Gets the current orientation of the UI in relation to the device (when AutoRotationPreferences cannot be honored) and applies a corrective rotation to the preview
    /// </summary>
    /// <returns></returns>
    function setPreviewRotation() {
        var previewVidTag = document.getElementById("cameraPreview");
        if (oDisplayOrientation == DisplayOrientations.portrait) {
            previewVidTag.style.height = "100%";
            previewVidTag.style.width = "";
        } else {
            previewVidTag.style.width = "100%";
            previewVidTag.style.height = "";
        }

        var videoRotation = convertDisplayOrientationToVideoRotation(oDisplayOrientation);
        return oMediaCapture.setPreviewRotation(videoRotation);
    }

    /// <summary>
    /// Stops the preview and deactivates a display request, to allow the screen to go into power saving modes
    /// </summary>
    /// <returns></returns>
    function stopPreview() {
        isPreviewing = false;

        // Cleanup the UI
        var previewVidTag = document.getElementById("cameraPreview");
        previewVidTag.pause();
        previewVidTag.src = null;

        // Allow the device screen to sleep now that the preview is stopped
        oDisplayRequest.requestRelease();
    }


    /// <summary>
    /// Attempts to find and return a device mounted on the panel specified, and on failure to find one it will return the first device listed
    /// </summary>
    /// <param name="panel">The desired panel on which the returned device should be mounted, if available</param>
    /// <returns></returns>
    function findCameraDeviceByPanelAsync(panel) {
        var deviceInfo = null;
        // Get available devices for capturing pictures
        return DeviceInformation.findAllAsync(DeviceClass.videoCapture)
        .then(function (devices) {
            devices.forEach(function (cameraDeviceInfo) {
                if (cameraDeviceInfo.enclosureLocation != null && cameraDeviceInfo.enclosureLocation.panel === panel) {
                    deviceInfo = cameraDeviceInfo;
                    return;
                }
            });

            // Nothing matched, just return the first
            if (!deviceInfo && devices.length > 0) {
                deviceInfo = devices.getAt(0);
            }

            return deviceInfo;
        });
    }

    /// <summary>
    /// Converts the given orientation of the app on the screen to the corresponding VideoRotation
    /// </summary>
    /// <param name="orientation">The orientation of the app on the screen</param>
    /// <returns>A Windows.Media.Capture.VideoRotation</returns>
    function convertDisplayOrientationToVideoRotation(orientation) {
        switch (orientation) {
            case DisplayOrientations.portrait:
                return Windows.Media.Capture.VideoRotation.clockwise90Degrees;
            case DisplayOrientations.landscapeFlipped:
                return Windows.Media.Capture.VideoRotation.clockwise180Degrees;
            case DisplayOrientations.portraitFlipped:
                return Windows.Media.Capture.VideoRotation.clockwise270Degrees;
            case DisplayOrientations.landscape:
            default:
                return Windows.Media.Capture.VideoRotation.none;
        }
    }

    /// <summary>
    /// This event will fire when the page is rotated, when the DisplayInformation.AutoRotationPreferences value set in the setupUiAsync() method cannot be not honored.
    /// </summary>
    /// <param name="sender">The event source.</param>
    function displayInformation_orientationChanged(args) {
        oDisplayOrientation = args.target.currentOrientation;
        setPreviewRotation();
    }


    /// <summary>
    /// In the event of the app being minimized this method handles media property change events. If the app receives a mute
    /// notification, it is no longer in the foregroud.
    /// </summary>
    /// <param name="args"></param>
    function systemMediaControls_PropertyChanged(args) {
        // Check to see if the app is being muted. If so, it is being minimized.
        // Otherwise if it is not initialized, it is being brought into focus.
        if (args.target.soundLevel === Media.SoundLevel.muted) {
            cleanupCameraAsync();
        }
        else if (!isInitialized) {
            initializeCameraAsync();
        }
    }

    function mediaCapture_failed(errorEventArgs) {
        console.log("MediaCapture_Failed: 0x" + errorEventArgs.code + ": " + errorEventArgs.message);

        cleanupCameraAsync().done();
    }


    module.exports = {
        /**
         * Scans image via device camera and retieves barcode from it.
         * @param  {function} success Success callback
         * @param  {function} fail    Error callback
         * @param  {array} args       Arguments array
         */
        scan: function (success, fail, args) {
            var reader = new ZXing.BarcodeReader();

            // First we create the HTML markup
            var canvasBuffer = document.createElement('canvas');

            var wrapper = document.createElement('div');
            wrapper.id = 'cameraWrapper';
            wrapper.style.cssText = 'position: absolute; z-index: 1000; ' +
                                    'left: 0; top: 0; right: 0; bottom: 0; ' +
                                    'background-color: black; ' +
                                    'overflow: hidden; ' +
                                    'touch-action:none;';

            var cameraPreview = document.createElement('video');
            cameraPreview.id = 'cameraPreview';
            cameraPreview.style.cssText = 'position: absolute; ' +
                                 'left: 50%; top: 50%; ' +
                                 'transform: translate(-50%, -50%);';

            var viewfinder = document.createElement('div');
            viewfinder.style.cssText = 'position: absolute; ' +
                                 'left: 50%; top: 50%; ' +
                                 'transform: translate(-50%, -50%); ' +
                                 'width: 200px; height: 200px; ' +
                                 'border: 1000px solid rgba(0, 0, 0, 0.5);';

            wrapper.appendChild(cameraPreview);
            wrapper.appendChild(viewfinder);
            document.body.appendChild(wrapper);

            var pauseHandler = function (e) {
                console.log('pause', e);
                stop();
            }

            var backbuttonHandler = function(e) {
                e.preventDefault();
                stop();
            }

            function stop() {
                cleanupCameraAsync();
                document.removeEventListener('pause', pauseHandler);
                document.removeEventListener('backbutton', backbuttonHandler);
                oDisplayInformation.removeEventListener("orientationchanged", displayInformation_orientationChanged);
                document.body.removeChild(wrapper);
            }

            function decodeFrame() {
                if (isPreviewing == false) {
                    console.log('Scan failed, not previewing.');
                    return fail();
                }

                canvasBuffer.width = cameraPreview.videoWidth;
                canvasBuffer.height = cameraPreview.videoHeight;

                var ctx = canvasBuffer.getContext('2d');
                ctx.drawImage(cameraPreview, 0, 0);

                var imageData = ctx.getImageData(0, 0, canvasBuffer.width, canvasBuffer.height);
                for (var option in args) {
                    reader.options[option] = args[option];
                }
                var result = reader.decode(imageData.data, imageData.width, imageData.height, ZXing.BitmapFormat.rgba32);
                if (result) {
                    stop();
                    success({ text: result.text, format: result.barcodeFormat });
                }
                else {
                    setTimeout(decodeFrame, 100);
                }

            }

            cameraPreview.onplaying = function () {
                isPreviewing = true;
                decodeFrame();
            }

            document.addEventListener('pause', pauseHandler);
            document.addEventListener('backbutton', backbuttonHandler);
            oDisplayInformation.addEventListener('orientationchanged', displayInformation_orientationChanged);
            initializeCameraAsync();
        }
    }
})();

require("cordova/exec/proxy").add("BarcodeScanner", module.exports);
