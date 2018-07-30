/*
 * Copyright © 2018, Octave Online LLC
 *
 * This file is part of Octave Online Server.
 *
 * Octave Online Server is free software: you can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * Octave Online Server is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public
 * License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Octave Online Server.  If not, see
 * <https://www.gnu.org/licenses/>.
 */

// Client-Side JavaScript for Octave Online

define(["jquery", "knockout", "canvg", "base64", "js/download", "ace/ext/static_highlight", "js/anal", "base64-toblob", "ismobile", "exports", "js/octfile", "js/bucket", "js/vars", "ko-takeArray", "require", "js/onboarding", "js/ws-shared", "js/utils", "blob", "jquery.md5", "jquery.purl", "ace/theme/crimson_editor", "ace/theme/merbivore_soft", "js/ko-ace"], function($, ko, canvg, Base64, download, aceStaticHighlight, anal, b64ToBlob, isMobile, exports, OctFile, Bucket, Var, koTakeArray, require, onboarding, WsShared, utils){

	/* * * * START KNOCKOUT SETUP * * * */

	// Skin MVVM class
	function Skin(name, aceTheme, iconColor){
		var self = this;

		// Main Bindings
		self.name = name;
		self.displayName = name.charAt(0).toUpperCase() + name.slice(1);
		self.iconColor = iconColor;
		self.rawAceTheme = aceTheme;
		self.aceTheme = "ace/theme/"+aceTheme;
		self.cssURL = "css/themes/"+self.name+".css?{!css-timestamp!}";
	}
	var availableSkins = [
		new Skin("fire", "crimson_editor", "black"),
		new Skin("lava", "merbivore_soft", "white"),
		new Skin("ice", "crimson_editor", "black"),
		new Skin("sun", "crimson_editor", "black"),
	];

	// Plot MVVM class
	function PlotObject(id){
		var self = this;

		// Main Bindings
		self.id = id;
		self.lineNumber = ko.observable(null);
		self.data = ""; // not an observable for performance reasons
		self.complete = ko.observable(false);

		// Functions
		self.addData = function(data){
			self.data += data;
		};
		self.setCurrent = function(){
			var arr = plotHistory();
			for (var i = arr.length - 1; i >= 0; i--) {
				if (arr[i].id === id) {
					currentPlotIdx(i);
				}
			}
		};
		self.downloadPng = function(){
			var plotCanvas = document.getElementById("plot_canvas");
			var filename = "octave-online-line-" + self.lineNumber() + ".png";

			var renderCallback = function(){
				plotCanvas.toBlob(function(blob){
					download(blob, filename);
				}, "image/png");
			};

			canvg(plotCanvas, self.data, {
				renderCallback: renderCallback,
				ignoreMouse: true
			});
		};
		self.downloadSvg = function(){
			var blob = new Blob([self.data], { type: "image/svg+xml" });
			var filename = "octave-online-line-" + self.lineNumber() + ".svg";

			download(blob, filename);
		};
		self.zoom = function(){
			$("#plot_figure_container").toggleClass("fullscreen");
		};
		self.completeData = ko.computed(function(){
			if (self.complete()) {
				return self.data;
			} else {
				return "";
			}
		});
		self.md5 = ko.computed(function(){
			return $.md5(self.completeData());
		});
		self.bindElement = function($el){
			self.complete.subscribe(function(){
				$el.append(self.completeData());
				$el.find(".inline-plot-loading").fadeOut(500);
			});
		};
	}

	// Initialize MVVM variables
	var allOctFiles = ko.observableArray([]);
	var selectedSkin = ko.observable(availableSkins[0]);
	var purpose = ko.observable("default");
	var vars = ko.observableArray([]);
	var plotHistory = ko.observableArray([]);
	var currentPlotIdx = ko.observable(-1);
	var viewModel = window.viewModel = {
		files: allOctFiles,
		openFile: ko.observable(),
		close: function(){
			OctMethods.editor.close();
		},
		selectedSkin: selectedSkin,
		purpose: purpose,
		vars: vars,
		plots: plotHistory,
		currentPlotIdx: currentPlotIdx,
		inlinePlots: ko.observable(true),
		instructorPrograms: ko.observableArray(),
		allBuckets: ko.observableArray(),
		newBucket: ko.observable(),

		// More for UI
		logoSrc: ko.computed(function() {
			var color = selectedSkin().iconColor;
			if (purpose() === "bucket") {
				return "images/logos/banner-" + color + "-bucket.svg";
			} else {
				return "images/logos/banner-" + color + ".svg";
			}
		}),

		// More for plots
		currentPlot: ko.computed(function(){
			if (currentPlotIdx()<0) return null;
			return plotHistory()[currentPlotIdx()];
		}),
		showPlot: ko.computed(function(){
			return currentPlotIdx() >= 0;
		}),
		togglePlot: function(){
			var idx = currentPlotIdx();
			var len = plotHistory().length;
			if (len === 0) {
				utils.alert("This button shows and hides the plot window.  Enter an expression that generates a plot.");
			} else if (idx < 0) {
				currentPlotIdx(len-1);
			} else {
				currentPlotIdx(-1);
			}
			OctMethods.prompt.focus();
		},
		firstPlotShown: ko.computed(function(){
			return currentPlotIdx() === 0;
		}),
		lastPlotShown: ko.computed(function(){
			return currentPlotIdx()+1 === plotHistory().length;
		}),
		showPrevPlot: function(){
			var idx = currentPlotIdx();
			if (idx <= 0) return null;
			currentPlotIdx(idx - 1);
		},
		showNextPlot: function(){
			var idx = currentPlotIdx();
			var len = plotHistory().length;
			if (idx+1 >= len) return null;
			currentPlotIdx(idx + 1);
		},

		// Sign In / Sign Out
		currentUser: ko.observable(),
		doLogout: function(){
			onboarding.reset();
			window.location.href = "/logout";
		},
		showChangePassword: function() {
			$("#change_password").showSafe();
			$("#new_pwd").focus();
		},

		unenrollStudent: function(user) {
			if (confirm("Are you sure that you want to remove the following student from your course?\n\nName: " + user.displayName + "\nCourse: " + user.program)) {
				OctMethods.socket.unenrollStudent(user);
			}
		},
		reenrollStudent: function(user) {
			var newProgram = prompt("Enter the course code to which you want to move this student:", "");
			var programs = viewModel.instructorPrograms();
			for (var i=0; i<programs.length; i++) {
				if (programs[i].program === newProgram) {
					OctMethods.socket.reenrollStudent(user, newProgram);
					utils.alert("The following student is being re-enrolled.  Reload the page to see the update.\n\nName: " + user.displayName + "\nNew Course: " + newProgram);
					return;
				}
			}
			utils.alert("Error: Could not find the program " + newProgram);
		},

		toggleSharing: function(){
			var shareKey = viewModel.currentUser().share_key;
			var program = viewModel.currentUser().program;
			if (program && program !== "default") {
				utils.alert("You cannot disable sharing as a student enrolled in an Octave Online program.  You need to remove yourself from \"" + program + "\" by running \"enroll('default')\" at the command prompt.");
			} else {
				OctMethods.socket.toggleSharing(!shareKey);
			}
		},

		getOctFileFromName: function(filename){
			// Since allOctFiles is always sorted, we can do binary search.
			return utils.binarySearch(allOctFiles(), filename, function(octfile) {
				return octfile.filename();
			});
		},
		fileNameExists: function(filename){
			// return false for filenames like .plot
			if (filename[0] === ".") return false;
			// also return false for the Octave namespace files
			if (filename.substr(0,7) === "octave-") return false;

			return !!viewModel.getOctFileFromName(filename);
		},

		cwd: ko.observable(""), // current working directory

		addTime: function() {
			OctMethods.prompt.addTime();
		},
		acknowledgePayload: function() {
			OctMethods.prompt.acknowledgePayload();
		},

		clearBucket: function() {
			viewModel.newBucket(null);
		},

		flex: {
			sizes: ko.observableArray([100, 400, 75, 325]),
			shown: ko.observable(false)
		}
	};
	viewModel.showUserInHeader = ko.computed(function(){
		return (viewModel.currentUser() && viewModel.purpose() === "student");
	});
	viewModel.shareLink = ko.computed(function(){
		if (!viewModel.currentUser()) return "";
		return window.location.origin + "/workspace~" + viewModel.currentUser().share_key;
	});
	viewModel.flex.outputCss = ko.computed(function(){
		return "flex-basis:" + (viewModel.flex.sizes()[2] + viewModel.flex.sizes()[3]) + "px";
	});
	viewModel.flex.sizes.extend({ localStorage: "flex:h" });
	viewModel.inlinePlots.extend({ localStorage: "inline-plots" });
	// Keep the console output visible when the plot window opens
	viewModel.showPlot.subscribe(function(){
		setTimeout(OctMethods.console.scroll, 0);
	});

	// Listener for showing and hiding the create-bucket promo
	viewModel.openFile.subscribe(function(octfile) {
		onboarding.toggleCreateBucketPromo(octfile && octfile.editable && viewModel.purpose() === "default");
	});

	/* * * * END KNOCKOUT, START EDITOR/CONSOLE/PROMPT * * * */

	function getOrMakePlotById(id){
		var arr = plotHistory();
		for (var i = arr.length - 1; i >= 0; i--) {
			if (arr[i].id === id) return arr[i];
		}

		// Make a new plot object
		var obj = new PlotObject(id);
		plotHistory.push(obj);

		// Display it, either inline or in the plot window
		if (viewModel.inlinePlots()) {
			obj.bindElement(OctMethods.console.writePlot());
		} else {
			obj.setCurrent();
		}

		return obj;
	}

	// Define a massive singleton object to contain all methods and listeners
	var OctMethods = {

		// Console Methods
		console: {
			write: function(content){
				$("#console").append(document.createTextNode(content));
				OctMethods.console.scroll();
			},
			writeError: function(content){
				var span = $("<span class=\"prompt_error\"></span>");
				span.append(document.createTextNode(content));
				$("#console").append(span);
				OctMethods.console.scroll();
			},
			writeRow: function(rowString){
				var rowSpan = $("<span class=\"prompt_row\"></span>");
				rowSpan.append(document.createTextNode(rowString));
				$("#console").append(rowSpan);
			},
			writeCommand: function(lineNumber, cmd){
				var rowString;
				if(lineNumber >= 0){
					rowString = "octave:" + lineNumber + "> ";
				}else if(lineNumber === -1){
					rowString = "> ";
				}else{
					rowString = "";
				}
				if(rowString) OctMethods.console.writeRow(rowString);

				var commandSpan = $("<span class=\"prompt_command\"></span>");
				commandSpan.append(document.createTextNode(cmd));
				$("#console").append(commandSpan);

				$("#console").append(document.createTextNode("\n"));

				OctMethods.console.scroll();
			},
			writeRestartBtn: function(){
				var options = $("<span></span>");

				// Construct the normal restart button
				var btn1 = $("<a class=\"clickable\"></a>");
				btn1.click(function(){
					OctMethods.socket.reconnect();
					options.remove();
				});
				var txt = "Click Here to Reconnect";
				btn1.append(document.createTextNode(txt));
				options.append(btn1);

				// Append to the console
				$("#console").append(options);
				$("#console").append(document.createTextNode("\n"));
				OctMethods.console.scroll();
			},
			writeUrl: function(url){
				var el = $("<a></a>");
				el.attr("href", url);
				el.attr("target", "_blank");
				el.append(document.createTextNode(url));
				$("#console").append(document.createTextNode("See "));
				$("#console").append(el);
				$("#console").append(document.createTextNode("\n"));
				OctMethods.console.scroll();
			},
			writePlot: function(){
				var el = $("<div></div>");
				el.attr("class", "inline-plot");
				var loading = $("<div></div>");
				loading.attr("class", "inline-plot-loading");
				el.append(loading);
				$("#console").append(el);
				OctMethods.console.scroll();
				return el;
			},
			scroll: function(){
				$("#console").scrollTop($("#console")[0].scrollHeight);
				$("#type_here").hideSafe();
			},
			clear: function(){
				$("#console").empty();
			},
			command: function(cmd, skipsend){
				if(!OctMethods.prompt.enabled) return;

				var currentLine = OctMethods.prompt.currentLine;

				// Show the command on screen
				OctMethods.console.writeCommand(currentLine, cmd);

				// Add command to history
				var history = OctMethods.prompt.history;
				if (cmd !== "" && history[history.length-2] !== cmd) {
					history[history.length-1] = cmd;
					history.push("");
				}
				OctMethods.prompt.index = history.length - 1;

				// Start countdown
				OctMethods.prompt.startCountdown();
				OctMethods.prompt.disable();

				// Send to server
				if (!skipsend) {
					OctMethods.socket.command(cmd);
				}
			}
		},

		// Prompt Methods
		prompt: {
			instance: null,
			currentLine: 0,
			history: [""],
			index: 0,
			legalTime: 5000,  // config.session.legalTime.guest
			extraTime: 0,
			countdownInterval: null,
			payloadTimerInterval: null,
			payloadDelay: -1,
			countdownTime: 0,
			countdownDelay: 20,
			enabled: true,
			enable: function(){
				$("#runtime_controls_container").hideSafe();
				$("#prompt").showSafe();
				$("#prompt_sign").showSafe();
				OctMethods.prompt.enabled = true;
				OctMethods.prompt.endCountdown();

				// There is a bug/feature in ACE that disables rendering when the element is hidden with display: none.  This hack forces a re-render now.
				OctMethods.prompt.instance.resize(true);
			},
			disable: function(){
				$("#prompt").hideSafe();
				$("#prompt_sign").hideSafe();
				OctMethods.prompt.enabled = false;
			},
			clear: function(){
				OctMethods.prompt.instance.setValue("");
			},
			focus: function(){
				OctMethods.prompt.instance.focus();
			},
			startCountdown: function(){
				$("#add_time_container").hideSafe();
				$("#payload_acknowledge_container").hideSafe();
				$("#runtime_controls_container").showSafe();
				OctMethods.prompt.countdownTime = new Date().valueOf();
				OctMethods.prompt.extraTime = 0;

				OctMethods.prompt.countdownTick();
				clearInterval(OctMethods.prompt.countdownInterval);
				OctMethods.prompt.countdownInterval = setInterval(
					OctMethods.prompt.countdownTick, OctMethods.prompt.countdownDelay
				);
			},
			countdownTick: function(){
				var elapsed = new Date().valueOf() - OctMethods.prompt.countdownTime;
				var remaining = (OctMethods.prompt.legalTime + OctMethods.prompt.extraTime - elapsed);
				if(remaining<=0) {
					clearInterval(OctMethods.prompt.countdownInterval);
					$("#seconds_remaining").text("---");
				}else{
					$("#seconds_remaining").text((remaining/1000).toFixed(2));
				}
				if (remaining <= 3000) {
					$("#add_time_container").showSafe();
				} else {
					$("#add_time_container").hideSafe();
				}
			},
			endCountdown: function(){
				clearInterval(OctMethods.prompt.countdownInterval);
				clearInterval(OctMethods.prompt.payloadTimerInterval);
				$("#runtime_controls_container").hideSafe();
				$("#seconds_remaining").text("0");

				if (OctMethods.prompt.countdownTime > 0)
					anal.duration(new Date().valueOf() - OctMethods.prompt.countdownTime);
			},
			startPayloadTimer: function(payloadDelay){
				// Similar, but not identical, to startCountdown()
				$("#add_time_container").hideSafe();
				$("#payload_acknowledge_container").showSafe();
				$("#runtime_controls_container").showSafe();
				OctMethods.prompt.countdownTime = new Date().valueOf(); // no need to create another countdownTime variable; can use the same one as regular countdown
				OctMethods.prompt.payloadDelay = payloadDelay;

				OctMethods.prompt.payloadTimerTick();
				clearInterval(OctMethods.prompt.payloadTimerInterval);
				OctMethods.prompt.payloadTimerInterval = setInterval(
					OctMethods.prompt.payloadTimerTick, OctMethods.prompt.countdownDelay
				);
			},
			payloadTimerTick: function(){
				// Similar, but not identical, to countdownTick()
				var elapsed = new Date().valueOf() - OctMethods.prompt.countdownTime;
				var remaining = (OctMethods.prompt.payloadDelay - elapsed);
				if(remaining<=0) {
					clearInterval(OctMethods.prompt.countdownInterval);
					$("#seconds_remaining").text("---");
				}else{
					$("#seconds_remaining").text((remaining/1000).toFixed(2));
				}
			},
			askForEnroll: function(program){
				if(!OctMethods.editor.initialized){
					utils.alert("You need to sign in to enroll in a course.");
					return;
				}

				if(confirm("Enroll in \"" + program + "\"?\n\n" +
					"When you enroll in a course, the instructors for that course " +
					"will be able to access the files you save in Octave Online. " +
					"You can cancel your enrollment at any time by running " +
					"enroll('default') at the command prompt.\n\n" +
					"Press Cancel if you don't know what any of this means.")){
					OctMethods.socket.enroll(program);
					viewModel.currentUser().program = program; // note: this is not observable
				}
			},
			addTime: function() {
				OctMethods.prompt.extraTime += parseInt("105!config.session.countdownExtraTime");
				OctMethods.socket.addTime();
				anal.extraTime();
			},
			acknowledgePayload: function() {
				// Acknowledging the payload resets the countdown on the server.
				OctMethods.prompt.endCountdown();
				OctMethods.prompt.startCountdown();
				OctMethods.socket.acknowledgePayload();
				anal.acknowledgePayload();
			}
		},

		// Prompt Callback Funcions
		promptListeners: {
			command: function(){
				var cmd = OctMethods.prompt.instance.getValue();

				// Check if this command is a front-end command
				var enrollRegex = /^enroll\s*\(['"](\w+)['"]\).*$/;
				var updateStudentsRegex = /^update_students\s*\(['"](\w+)['"]\).*$/;
				var pingRegex = /^ping$/;

				var program;
				if(enrollRegex.test(cmd)){
					program = cmd.match(enrollRegex)[1];
					OctMethods.prompt.askForEnroll(program);
					OctMethods.prompt.clear();
				}else if(updateStudentsRegex.test(cmd)){
					program = cmd.match(updateStudentsRegex)[1];
					OctMethods.socket.updateStudents(program);
					OctMethods.prompt.clear();
				}else if(pingRegex.test(cmd)) {
					OctMethods.socket.ping();
					OctMethods.prompt.clear();
				}else{
					OctMethods.console.command(cmd);
					OctMethods.prompt.clear();
				}

				anal.command(cmd);
			},
			signal: function(){
				// Trigger both a signal and an empty command upstream.  The empty command will sometimes help if, for any reason, the "prompt" message was lost in transit.
				// This could be slightly improved by adding the empty command elsewhere in the stack, to reduce the number of packets that need to be sent.
				OctMethods.socket.signal();
				OctMethods.socket.command("");
				anal.sigint();
			},
			historyUp: function(prompt){
				var history = OctMethods.prompt.history;
				if (OctMethods.prompt.index == history.length-1){
					history[history.length-1] = prompt.getValue();
				}
				if (OctMethods.prompt.index > 0){
					OctMethods.prompt.index -= 1;
					prompt.setValue(history[OctMethods.prompt.index]);
					prompt.getSelection().clearSelection();
				}
			},
			historyDown: function(prompt){
				var history = OctMethods.prompt.history;
				if (OctMethods.prompt.index < history.length-1){
					OctMethods.prompt.index += 1;
					prompt.setValue(history[OctMethods.prompt.index]);
					prompt.getSelection().clearSelection();
				}
			},
			keyFocus: function(e){
				e.preventDefault();
				OctMethods.prompt.focus();
			},
			permalink: function(){
				// TODO: Add this directly into purl
				var cmd = $(this).text();
				window.location.hash = "cmd=" + encodeURIComponent(cmd);
			}
		},

		// Socket Methods
		socket: {
			instance: null,
			sessCode: null,
			signal: function(){
				return OctMethods.socket.emit("signal", {});
			},
			command: function(cmd){
				return OctMethods.socket.emit("data", {
					data: cmd
				});
			},
			save: function(octfile){
				return OctMethods.socket.emit("save", {
					filename: octfile.filename(),
					content: octfile.content()
				});
			},
			rename: function(octfile, newName){
				return OctMethods.socket.emit("rename", {
					filename: octfile.filename(),
					newname: newName
				});
			},
			deleteit: function(octfile){
				return OctMethods.socket.emit("delete", {
					filename: octfile.filename()
				});
			},
			binary: function(octfile){
				return OctMethods.socket.emit("binary", {
					filename: octfile.filename()
				});
			},
			enroll: function(program){
				return OctMethods.socket.emit("enroll", {
					program: program
				});
			},
			updateStudents: function(program){
				return OctMethods.socket.emit("update_students", {
					program: program
				});
			},
			unenrollStudent: function(user){
				return OctMethods.socket.emit("oo.unenroll_student", {
					userId: user._id
				});
			},
			reenrollStudent: function(user, newProgram){
				return OctMethods.socket.emit("oo.reenroll_student", {
					userId: user._id,
					program: newProgram
				});
			},
			ping: function() {
				return OctMethods.socket.emit("oo.ping", {
					startTime: new Date().valueOf()
				});
			},
			refresh: function(){
				return OctMethods.socket.emit("refresh", {});
			},
			toggleSharing: function(enabled){
				return OctMethods.socket.emit("oo.toggle_sharing", {
					enabled: enabled
				});
			},
			addTime: function() {
				return OctMethods.socket.emit("oo.add_time", {});
			},
			acknowledgePayload: function() {
				return OctMethods.socket.emit("oo.acknowledge_payload", {});
			},
			setPassword: function(password) {
				return OctMethods.socket.emit("oo.set_password", {
					new_pwd: password
				});
			},
			createBucket: function(bucket) {
				return OctMethods.socket.emit("oo.create_bucket", {
					filenames: ko.utils.arrayMap(bucket.files(), function(octfile){
						return octfile.filename();
					}),
					main: bucket.mainFilename()
				});
			},
			deleteBucket: function(bucket) {
				return OctMethods.socket.emit("oo.delete_bucket", {
					bucket_id: bucket.id()
				});
			},
			emit: function(message, data){
				if (!OctMethods.socket.instance
					|| !OctMethods.socket.instance.connected) {
					console.log("Socket Closed", message, data);
					return false;
				}
				OctMethods.socket.instance.emit(message, data);
				return true;
			},
			reconnect: function(){
				OctMethods.load.showLoader();
				OctMethods.load.startPatience();

				return OctMethods.socket.emit("oo.reconnect", {});
			}
		},

		// Socket Callback Functions
		socketListeners: {
			data: function(data){
				switch(data.type){
					case "stdout":
						OctMethods.console.write(data.data);
						break;
					case "stderr":
						OctMethods.console.writeError(data.data);
						break;
					case "exit":
						console.log("exit code: " + data.code);
						break;
					default:
						console.log("unknown data type: " + data.type);
				}
			},
			alert: function(message) {
				utils.alert(message);
			},
			prompt: function(data){
				var lineNumber = data.line_number || 0;

				// Turn on the input prompt and set the current line number
				OctMethods.prompt.currentLine = lineNumber;
				OctMethods.prompt.enable();

				// Perform other cleanup logic
				if(OctMethods.editor.running){
					if(lineNumber > 0){
						OctMethods.editor.running = false;
					}else{
						OctMethods.prompt.focus();
					}
				}else if(isMobile && lineNumber>1){
					OctMethods.prompt.focus();
					setTimeout(function(){
						// Does not quite work
						window.scrollTo(0,document.body.scrollHeight);
					}, 500);
				}else if(!isMobile){
					OctMethods.prompt.focus();
				}
			},
			saved: function(data){
				if (!data.success) return;
				var octfile = viewModel.getOctFileFromName(data.filename);
				if (!octfile) return;
				if (octfile.md5() === data.md5sum) {
					octfile.savedContent(octfile.content());
				} else {
					console.log("Mismatched MD5! Local:", octfile.md5(), "Server:", data.md5sum);
				}
			},
			renamed: function(data){
				var oldname = data.oldname, newname = data.newname;
				var octfile = viewModel.getOctFileFromName(oldname);
				if(!octfile) return;

				// Rename the file throughout the schema
				octfile.filename(newname);
				allOctFiles.sort(OctFile.sorter);
			},
			deleted: function(data){
				var octfile = viewModel.getOctFileFromName(data.filename);
				if(!octfile) return;
				if (viewModel.openFile() === octfile) {
					OctMethods.editor.close();
				}
				OctMethods.editor.remove(octfile);
			},
			binary: function(data){
				var octfile = viewModel.getOctFileFromName(data.filename);
				if(!octfile) return;

				// Attempt to download the file
				console.log("Downloading binary file", octfile);
				var blob = b64ToBlob(data.base64data, data.mime);
				return download(blob, octfile.filename());
			},
			user: function(data){
				// One-time methods
				if (!OctMethods.editor.initialized && data) {
					OctMethods.editor.initialized = true;

					// Set up the UI
					onboarding.hideScriptPromo();
					onboarding.hideBucketPromo();

					// Trigger Knockout
					data.name = data.name || data.displayName;
					viewModel.currentUser(data);

					// Legal runtime
					OctMethods.prompt.legalTime = data.legalTime;

					// Analytics
					anal.signedin();
				}
			},
			dir: function(data){
				// Load files
				if (!data.success) {
					OctMethods.load.callback();
					return utils.alert(data.message);
				}
				if (allOctFiles().length === 0) {
					$.each(data.files, function(filename, filedata){
						if(filedata.isText){
							OctMethods.editor.add(filename, Base64.decode(filedata.content));
						}else{
							OctMethods.editor.addNameOnly(filename);
						}
					});

					// Set up the UI
					$("#open_container").showSafe();
					$("#files_container").showSafe();
					if (!OctMethods.vars.bucketId) {
						onboarding.showSyncPromo();
					}

					// Fire a window "resize" event to make sure everything adjusts,
					// like the ACE editor in the prompt
					var evt = document.createEvent("UIEvents");
					evt.initUIEvent("resize", true, false, window, 0);
					window.dispatchEvent(evt);

					// If we are in a bucket, auto-open the main file.
					if (OctMethods.vars.bucketInfo && OctMethods.vars.bucketInfo.main) {
						var filename = OctMethods.vars.bucketInfo.main;
						var octfile = viewModel.getOctFileFromName(filename);
						if (octfile) {
							octfile.open();
						}
					}

				} else {
					// If the files were already loaded, update the saved content. This will make files show as unsaved if they are out-of-sync with the server.  Don't do anything more drastic, like requesting a file save, because the user might not want a file save in the case of a filelist event being emitted when someone joins a shared workspace session.  Also note that this could have a race condition if a save was performed after the files were read from the server; simply marking the file as unsaved is harmless and won't cause conflicts.
					$.each(data.files, function(filename, filedata){
						if (!filedata.isText) return;
						var octfile = viewModel.getOctFileFromName(filename);
						if (octfile) {
							octfile.savedContent(Base64.decode(filedata.content));
						}
					});
				}
			},
			fileadd: function(data){
				if(data.isText){
					var octFile = OctMethods.editor.add(data.filename,
						Base64.decode(data.content));
					OctMethods.editor.open(octFile);
				}else{
					OctMethods.editor.addNameOnly(data.filename);
				}
			},
			plotd: function(data){
				// plot data transmission
				var plot = getOrMakePlotById(data.id);
				plot.addData(data.content);
				console.log("Received data for plot ID "+data.id);
			},
			plote: function(data){
				// plot data complete
				var plot = getOrMakePlotById(data.id);
				plot.lineNumber(data.command_number - 1);
				plot.complete(true);

				if(data.md5 !== plot.md5()){
					// should never happen
					console.log("MD5 discrepancy!");
					console.log(data);
					console.log(plot.md5());
				}
			},
			ctrl: function(data){
				// command from shell
				console.log("Received ctrl '", data.command, "' from server");
				if(data.command === "clc"){
					OctMethods.console.clear();
				}else if(data.command.substr(0,4) === "url="){
					OctMethods.console.writeUrl(data.command.substr(4));
				}else if(data.command.substr(0,6) === "enroll"){
					OctMethods.prompt.askForEnroll(data.command.substr(7));
				}
			},
			vars: function(data){
				// update variables
				koTakeArray(Var, vars, "symbol",
					data.vars, "symbol");
				vars.sort(Var.sorter);
			},
			sesscode: function(data){
				console.log("SESSCODE:", data.sessCode);
				OctMethods.socket.sessCode = data.sessCode;
			},
			reload: function(){
				window.location.reload();
			},
			instructor: function(data){
				data.users.forEach(function(user){
					user.shareUrl = window.location.origin + window.location.pathname
						+ "?s=" + user.share_key;
				});
				viewModel.instructorPrograms.push(data);
			},
			bucketInfo: function(data){
				OctMethods.vars.bucketInfo = data;
			},
			bucketCreated: function(data) {
				var bucket = Bucket.fromBucketInfo(data.bucket);
				// To stay on this page, the following lines should be run, but since we are always redirecting, they are not necessary and cause the screen to flash.
				// viewModel.allBuckets.push(bucket);
				// viewModel.newBucket(null);
				window.location.href = bucket.url();
			},
			bucketDeleted: function(data) {
				var bucket = ko.utils.arrayFirst(viewModel.allBuckets(), function(bucket) {
					return bucket.id() === data.bucket_id;
				}, null);
				viewModel.allBuckets.remove(bucket);
			},
			allBuckets: function(data) {
				// N-squared loop, but it should be small enough not to be an issue
				$.each(data.buckets, function(i, bucketInfo) {
					var found = false;
					$.each(viewModel.allBuckets(), function(j, bucket){
						if (bucket.id() === bucketInfo.bucket_id) {
							found = true;
							return false; // break
						}
					});
					if (!found) {
						viewModel.allBuckets.push(Bucket.fromBucketInfo(bucketInfo));
					}
				});
			},
			pong: function(data) {
				var startTime = parseInt(data.startTime);
				var endTime = new Date().valueOf();
				OctMethods.console.write("Ping time: " + (endTime-startTime) + "ms\n");
			},
			restartCountdown: function(){
				// TODO: Is this method dead?
				OctMethods.prompt.startCountdown();
			},
			changeDirectory: function(data) {
				viewModel.cwd(data.dir);
			},
			editFile: function(data) {
				if (!data || !data.file) return;
				var match = data.file.match(/^\/home\/[^/]+\/(.*)$/);
				if (!match) return;
				var filename = match[1];
				var octfile = viewModel.getOctFileFromName(filename);
				if (!octfile) {
					// New file
					octfile = OctMethods.editor.create(filename);
				}
				if (octfile) {
					octfile.open();
				}
			},
			payloadPaused: function(data){
				OctMethods.prompt.endCountdown();
				OctMethods.prompt.startPayloadTimer(data.delay);

				// Show the notification message after a small delay in order to let the output buffers flush first.
				setTimeout(function(){
					OctMethods.console.writeError("\nNOTICE: Execution paused due to large payload\n");
				}, parseInt("105!config.session.payloadMessageDelay"));
			},
			init: function(){
				// Regular session or shared session?
				if (OctMethods.vars.wsId) {
					OctMethods.socket.emit("init", {
						action: "workspace",
						info: OctMethods.vars.wsId
					});

				}else if(OctMethods.vars.studentId){
					OctMethods.socket.emit("init", {
						action: "student",
						info: OctMethods.vars.studentId
					});

				}else if (OctMethods.vars.bucketId){
					OctMethods.socket.emit("init", {
						action: "bucket",
						info: OctMethods.vars.bucketId
					});

				}else{
					OctMethods.socket.emit("init", {
						action: "session",
						info: OctMethods.socket.sessCode
					});
				}
			},
			filesReady: function() {
				// hide the coverall loading div if necessary
				OctMethods.load.callback();
			},
			destroyu: function(message){
				OctMethods.console.writeError("Octave Exited. Message: "+message+"\n");
				OctMethods.console.writeRestartBtn();

				// Clean up UI
				OctMethods.prompt.disable();
				OctMethods.prompt.endCountdown();
				OctMethods.load.hideLoader();
			},
			disconnect: function(){
				OctMethods.console.writeError("Connection lost.  Attempting to reconnect...\n");
				
				// Clean up UI
				OctMethods.prompt.disable();
				OctMethods.prompt.endCountdown();
				OctMethods.load.showLoader();
			}
		},

		// Editor Methods
		editor: {
			instance: null,
			defaultFilename: "my_script.m",
			defaultContent: "disp(\"Hello World\");\n",
			running: false,
			initialized: false,
			bucketWarned: false,
			save: function(octfile){
				if (viewModel.purpose() === "bucket" && !OctMethods.editor.bucketWarned) {
					utils.alert("Note: This is a read-only bucket. Changes you make will not be persisted after you close your browser window.");
					OctMethods.editor.bucketWarned = true;
				}
				return OctMethods.socket.save(octfile);
			},
			add: function(filename, content){
				var octfile = new OctFile(filename, content, true);
				allOctFiles.push(octfile);
				allOctFiles.sort(OctFile.sorter);
				return octfile;
			},
			addNameOnly: function(filename){
				var octfile = new OctFile(filename, "", false);
				allOctFiles.push(octfile);
				allOctFiles.sort(OctFile.sorter);
				return octfile;
			},
			create: function(filename){
				// check to see if the file already exists
				if (viewModel.fileNameExists(filename)) {
					return false;
				}
				// check for valid filename
				if(!OctFile.regexps.filename.test(filename)){
					return false;
				}
				var octfile = OctMethods.editor.add(
					filename,
					OctMethods.editor.defaultContent);
				OctMethods.editor.save(octfile);
				return octfile;
			},
			remove: function(octfile){
				allOctFiles.remove(octfile);
			},
			deleteit: function(octfile){
				return OctMethods.socket.deleteit(octfile);
			},
			run: function(octfile){
				var cmd = octfile.command();
				if(!cmd) return false;
				OctMethods.console.command(cmd);
				OctMethods.editor.running = true;
				anal.runfile();
				return true;
			},
			rename: function(octfile){
				var oldName = octfile.filename();
				var newName = prompt("Enter a new filename:", oldName);
				if (!newName || oldName === newName) return false;
				if (viewModel.fileNameExists(newName)){
					utils.alert("The specified filename already exists.");
					return false;
				}
				return OctMethods.socket.rename(octfile, newName);
			},
			download: function(octfile){
				// Two cases: front-end text file or back-end binary file.
				if(octfile.editable){
					// If it's a text file, we can download it now
					var mime = "text/x-octave;charset=utf-8";
					var blob = new Blob([octfile.content()], { type: mime });
					return download(blob, octfile.filename());
				}else{
					// If it's a binary file, we have to request it from the server
					return OctMethods.socket.binary(octfile);
				}
			},
			print: function(octfile){
				// Make a new window and a temporary document object
				var w = window.open();
				var doc = $("<div>");

				// Add a title line
				var h1 = $("<h1>");
				h1.append(octfile.filename());
				h1.css("font", "bold 14pt/14pt 'Trebuchet MS',Verdana,sans-serif");
				h1.css("margin", "6pt");
				doc.append(h1);

				// Create the Ace highlighter
				var highlight = aceStaticHighlight.render(
					octfile.content(),
					new (require("ace/mode/octave").Mode)(),
					require("ace/theme/crimson_editor")
				);

				// Create the Ace stylesheet
				var ss = $("<style type='text/css'></style>");
				ss.append(highlight.css);

				// Append the Ace highlighter and stylesheet
				var editorDiv = $("<div></div>");
				editorDiv.append(highlight.html);
				doc.append(ss);
				doc.append(editorDiv);

				// Add a credit line at the bottom
				var creditDiv = $("<div></div>");
				creditDiv.append("Printed for " + viewModel.currentUser().name);
				creditDiv.append("<br/>");
				creditDiv.append("Powered by Octave Online");
				creditDiv.append("<br/>");
				creditDiv.append("http://octave-online.net");
				creditDiv.css("font", "10pt/10pt 'Trebuchet MS',Verdana,sans-serif");
				creditDiv.css("text-align", "right");
				creditDiv.css("margin-top", "16pt");
				doc.append(creditDiv);

				// Add the document data to the window
				w.document.body.innerHTML += doc.html();

				// Trigger Print
				w.window.print();
			},
			open: function(octfile){
				viewModel.openFile(octfile);
			},
			close: function(){
				viewModel.openFile(null);
			},
			reset: function(){
				viewModel.openFile(null);
				allOctFiles.removeAll();
			},
			startNewBucket: function(octfile){
				var bucket = new Bucket();
				bucket.files.push(octfile);
				bucket.main(octfile);
				viewModel.newBucket(bucket);
				$("#create_bucket").showSafe();
			}
		},

		// Editor Callback Functions
		editorListeners: {
			newCB: function(){
				var filename = OctMethods.editor.defaultFilename;
				// do..while to protect against duplicate file names
				do{
					filename = prompt("Please enter a filename:", filename);
				} while(filename && !OctMethods.editor.create(filename));
			},
			refresh: function(){
				if(confirm("This will reload your files from the server. Any " +
					"unsaved changes will be lost.")){
					OctMethods.editor.reset();
					OctMethods.socket.refresh();
				}
			},
			info: function(){
				var currentUser = window.viewModel.currentUser();
				var parametrized = currentUser ? currentUser.parametrized : "unknown";
				var email = currentUser ? currentUser.email : "";
				window.open("https://git.octave-online.net/?next=" + parametrized + ".git&user=" + email);
			},
			run: function(){
				OctMethods.editor.run(viewModel.openFile());
			},
			keyRun: function(e){
				e.preventDefault();
				if(viewModel.openFile()){
					OctMethods.editor.run(viewModel.openFile());
				}
			}
		},

		load: {
			firstConnection: true,
			loaderVisible: true,
			bePatientTimeout: null,
			callback: function(){
				if(OctMethods.load.loaderVisible){
					OctMethods.load.hideLoader();
				}
				if(OctMethods.load.firstConnection){
					OctMethods.load.firstConnection = false;

					// UI setup
					$("#type_here").showSafe();
					$("#vars_panel").showSafe();

					// Evaluate the query string command (uses purl)
					try{
						var initCmd = $.url().fparam("cmd");
					}catch(e){
						console.log(e);
					}

					// Initial bucket command
					if (!initCmd && OctMethods.vars.bucketInfo && OctMethods.vars.bucketInfo.main) {
						initCmd = "source(\"" + OctMethods.vars.bucketInfo.main + "\");";
					}

					if(initCmd){
						OctMethods.console.command(initCmd);
					}
				}
			},
			showLoader: function(){
				OctMethods.load.loaderVisible = true;
				$("#site_loading").showSafe();
			},
			hideLoader: function(){
				OctMethods.load.loaderVisible = false;
				OctMethods.load.stopPatience();
				$("#site_loading").fadeOutSafe(500);
			},
			startPatience: function(){
				OctMethods.load.stopPatience();
				OctMethods.load.bePatientTimeout = setTimeout(function(){
					$("#site_loading_patience").showSafe();
					anal.patience();
					OctMethods.load.bePatientTimeout = setTimeout(function(){
						$("#site_loading_patience").hideSafe();
						$("#site_loading_more_patience").showSafe();
						OctMethods.load.bePatientTimeout = null;
					}, 35000);
				}, 10000);
			},
			stopPatience: function(){
				$("#site_loading_patience").hideSafe();
				$("#site_loading_more_patience").hideSafe();
				if (!OctMethods.load.bePatientTimeout) return;
				clearTimeout(OctMethods.load.bePatientTimeout);
				OctMethods.load.bePatientTimeout = null;
			}
		},

		// Other accessor properties
		ko: {
			viewModel: viewModel,
			allOctFiles: allOctFiles,
			availableSkins: availableSkins
		},
		vars: {
			wsId: null,
			studentId: null,
			bucketId: null,
			bucketInfo: null
		}
	};

	// Expose
	exports.console = OctMethods.console;
	exports.prompt = OctMethods.prompt;
	exports.promptListeners = OctMethods.promptListeners;
	exports.plot = OctMethods.plot;
	exports.socket = OctMethods.socket;
	exports.socketListeners = OctMethods.socketListeners;
	exports.editor = OctMethods.editor;
	exports.editorListeners = OctMethods.editorListeners;
	exports.load = OctMethods.load;
	exports.ko = OctMethods.ko;
	exports.vars = OctMethods.vars;

}); // AMD Define