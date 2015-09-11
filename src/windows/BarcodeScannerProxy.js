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
        oDisplayOrientation = DisplayOrientations.portrait;

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

    // Initialization
    var app = WinJS.Application;
    var activation = Windows.ApplicationModel.Activation;
    app.onactivated = function (args) {
        console.log('onactivated', args)
        //if (args.detail.kind === activation.ActivationKind.launch) {
        //    if (args.detail.previousExecutionState !== activation.ApplicationExecutionState.terminated) {
        //        document.getElementById("getPreviewFrameButton").addEventListener("click", getPreviewFrameButton_tapped);
        //        previewFrameImage.src = null;
        //    }

        //    oDisplayInformation.addEventListener("orientationchanged", displayInformation_orientationChanged);
        //    initializeCameraAsync();
        //    args.setPromise(WinJS.UI.processAll());
        //}
    };

    // About to be suspended
    app.oncheckpoint = function (args) {
        console.log('oncheckpoint', args)
        // Handling of this event is included for completeness, as it will only fire when navigating between pages and this sample only includes one page
        oDisplayInformation.removeEventListener("orientationchanged", displayInformation_orientationChanged);
        args.setPromise(cleanupCameraAsync());
    };

    // Closing
    app.onunload = function (args) {
        console.log('onunload', args)
        oDisplayInformation.removeEventListener("orientationchanged", displayInformation_orientationChanged);
        //document.getElementById("getPreviewFrameButton").removeEventListener("click", getPreviewFrameButton_tapped);
        oSystemMediaControls.removeEventListener("propertychanged", systemMediaControls_PropertyChanged);

        args.setPromise(cleanupCameraAsync());
    };

    // Resuming from a user suspension
    Windows.UI.WebUI.WebUIApplication.addEventListener("resuming", function () {
        console.log('resuming')
        oDisplayInformation.addEventListener("orientationchanged", displayInformation_orientationChanged);
        initializeCameraAsync();
    }, false);

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
        var previewVidTag = document.getElementById("cameraPreview");
        if (mirroringPreview) {
            cameraPreview.style.transform = "scale(-1, 1)";
        }

        var previewUrl = URL.createObjectURL(oMediaCapture);
        previewVidTag.src = previewUrl;
        previewVidTag.play();

        previewVidTag.addEventListener("playing", function () {
            isPreviewing = true;
            setPreviewRotationAsync();
        });
    }

    /// <summary>
    /// Gets the current orientation of the UI in relation to the device (when AutoRotationPreferences cannot be honored) and applies a corrective rotation to the preview
    /// </summary>
    /// <returns></returns>
    function setPreviewRotationAsync() {
        // Only need to update the orientation if the camera is mounted on the device
        if (externalCamera) {
            return WinJS.Promise.as();
        }

        // Calculate which way and how far to rotate the preview
        var rotationDegrees = convertDisplayOrientationToDegrees(oDisplayOrientation);

        // The rotation direction needs to be inverted if the preview is being mirrored
        if (mirroringPreview) {
            rotationDegrees = (360 - rotationDegrees) % 360;
        }

        // Add rotation metadata to the preview stream to make sure the aspect ratio / dimensions match when rendering and getting preview frames
        var props = oMediaCapture.videoDeviceController.getMediaStreamProperties(Capture.MediaStreamType.videoPreview);
        props.properties.insert(RotationKey, rotationDegrees);
        return oMediaCapture.setEncodingPropertiesAsync(Capture.MediaStreamType.videoPreview, props, null);
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
    /// Converts the given orientation of the app on the screen to the corresponding rotation in degrees
    /// </summary>
    /// <param name="orientation">The orientation of the app on the screen</param>
    /// <returns>An orientation in degrees</returns>
    function convertDisplayOrientationToDegrees(orientation) {
        switch (orientation) {
            case DisplayOrientations.portrait:
                return 90;
            case DisplayOrientations.landscapeFlipped:
                return 180;
            case DisplayOrientations.portraitFlipped:
                return 270;
            case DisplayOrientations.landscape:
            default:
                return 0;
        }
    }

    /// <summary>
    /// This event will fire when the page is rotated, when the DisplayInformation.AutoRotationPreferences value set in the setupUiAsync() method cannot be not honored.
    /// </summary>
    /// <param name="sender">The event source.</param>
    function displayInformation_orientationChanged(args) {
        oDisplayOrientation = args.target.currentOrientation;

        if (isPreviewing) {
            setPreviewRotationAsync();
        }
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
            var barcodeReader = new ZXing.BarcodeReader();

            // First we create the HTML markup
            var canvasBuffer = document.createElement('canvas');

            var wrapper = document.createElement('div');
            wrapper.style.cssText = 'position: absolute; z-index: 1000; ' +
                                    'left: 0; top: 0; right: 0; bottom: 0; ' +
                                    'background-color: black; ' +
                                    'touch-action:none;';

            var cameraPreview = document.createElement('video');
            cameraPreview.id = 'cameraPreview';
            cameraPreview.style.cssText = 'display:block; width: 100%; height: 100%';

            var viewfinder = document.createElement('div');
            viewfinder.style.cssText = 'position: absolute; ' +
                                 'left: 50%; top: 50%; ' +
                                 'transform: translate(-50%, -50%); ' +
                                 'width: 200px; height: 200px; ' +
                                 'border: 1000px solid rgba(0, 0, 0, 0.5);';

            wrapper.appendChild(cameraPreview);
            wrapper.appendChild(viewfinder);
            document.body.appendChild(wrapper);

            function stop() {
                cleanupCameraAsync();
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

                if (oDisplayOrientation == DisplayOrientations.portrait) {
                    // Why!!??
                    ctx.drawImage(
                        cameraPreview,
                        -(cameraPreview.videoWidth / 2), 0,
                        cameraPreview.videoWidth * 2, cameraPreview.videoHeight
                    );
                } else {
                    ctx.drawImage(cameraPreview, 0, 0);
                }
                var base64string = canvasBuffer.toDataURL();

                var reader = new WinRTBarcodeReader.Reader();
                reader.init();
                reader.readCode(base64string.replace(/data:image\/.*,/, '')).done(function (result) {
                    if (result != null) {
                        console.log('Scan success', result);
                        stop();
                        success({ text: result && result.text, format: result && result.barcodeFormat, cancelled: !result });
                    } else {
                        setTimeout(decodeFrame, 100);
                    }
                }, function (err) {
                    console.log('Scan error', err);
                    stop();
                    fail(err);
                });
            }

            cameraPreview.onplaying = function () {
                isPreviewing = true;
                decodeFrame();
            }

            initializeCameraAsync();
            oDisplayInformation.addEventListener('orientationchanged', displayInformation_orientationChanged);

            var backbuttonHandler = function (e) {
                document.removeEventListener('backbutton', backbuttonHandler);
                e.preventDefault();
                stop();
            }
            document.addEventListener('backbutton', backbuttonHandler);
        }
    }
})();

require("cordova/exec/proxy").add("BarcodeScanner", module.exports);
