/*
 * Copyright 2018 Gildas Lormeau
 * contact : gildas.lormeau <at> gmail.com
 * 
 * This file is part of SingleFile.
 *
 *   SingleFile is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   SingleFile is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with SingleFile.  If not, see <http://www.gnu.org/licenses/>.
 */

/* global fontFaceProxy */

this.docHelper = this.docHelper || (() => {

	const REMOVED_CONTENT_ATTRIBUTE_NAME = "data-single-file-removed-content";
	// const REMOVED_CANDIDATE_ATTRIBUTE_NAME = "data-single-file-removed-candidate";
	const PRESERVED_SPACE_ELEMENT_ATTRIBUTE_NAME = "data-single-file-preserved-space-element";
	const WIN_ID_ATTRIBUTE_NAME = "data-frame-tree-win-id";
	const RESPONSIVE_IMAGE_ATTRIBUTE_NAME = "data-single-file-responsive-image";
	const IMAGE_ATTRIBUTE_NAME = "data-single-file-image";
	const INPUT_VALUE_ATTRIBUTE_NAME = "data-single-file-value";
	const SHEET_ATTRIBUTE_NAME = "data-single-file-sheet";
	const IGNORED_REMOVED_TAG_NAMES = ["NOSCRIPT", "DISABLED-NOSCRIPT", "META", "LINK", "STYLE", "TITLE", "TEMPLATE", "SOURCE", "OBJECT"];
	const MASK_TAGNAME = "singlefile-mask";
	const BACKDROP_THRESHOLD_SIZE = .95;
	const BACKDROP_THRESHOLD_ZINDEX = 999;

	return {
		preProcessDoc,
		postProcessDoc,
		serialize,
		windowIdAttributeName,
		preservedSpaceAttributeName,
		removedContentAttributeName,
		responsiveImagesAttributeName,
		imagesAttributeName,
		inputValueAttributeName,
		sheetAttributeName
	};

	function preProcessDoc(doc, win, options) {
		doc.querySelectorAll("script").forEach(element => element.textContent = element.textContent.replace(/<\/script>/gi, "<\\/script>"));
		doc.querySelectorAll("noscript").forEach(element => {
			const disabledNoscriptElement = doc.createElement("disabled-noscript");
			Array.from(element.childNodes).forEach(node => disabledNoscriptElement.appendChild(node));
			disabledNoscriptElement.hidden = true;
			element.parentElement.replaceChild(disabledNoscriptElement, element);
		});
		doc.head.querySelectorAll("*:not(base):not(link):not(meta):not(noscript):not(script):not(style):not(template):not(title)").forEach(element => element.hidden = true);
		if (options.removeHiddenElements) {
			const markerRemovedContent = removedContentAttributeName(options.sessionId);
			let ignoredTags = JSON.parse(JSON.stringify(IGNORED_REMOVED_TAG_NAMES));
			if (!options.removeScripts) {
				ignoredTags = ignoredTags.concat("SCRIPT");
			}
			if (win) {
				markHiddenCandidates(win, doc.body, markerRemovedContent, new Set(), ignoredTags, new Map());
				markHiddenElements(win, doc.body, markerRemovedContent);
				markBackdropBackground(doc, win, markerRemovedContent);
			}
		}
		if (win && options.compressHTML) {
			doc.querySelectorAll("*").forEach(element => {
				const style = win.getComputedStyle(element);
				if (style && style.whiteSpace.startsWith("pre")) {
					element.setAttribute(preservedSpaceAttributeName(options.sessionId), "");
				}
			});
		}
		retrieveInputValues(doc, options);
		return {
			canvasData: win && getCanvasData(doc, win),
			fontsData: getFontsData(doc),
			stylesheetContents: getStylesheetContents(doc),
			responsiveImageData: getResponsiveImageData(doc, options),
			imageData: win && getImageData(doc, win, options),
			postersData: getPostersData(doc)
		};
	}

	function markBackdropBackground(doc, win, markerRemovedContent) {
		const threshold = BACKDROP_THRESHOLD_SIZE;
		let elements = getCandidateElements();
		let fullScreen = true;
		while (elements.length > 1 && fullScreen) {
			elements = getCandidateElements();
			const element = elements[0];
			const style = win.getComputedStyle(element);
			fullScreen = (element.clientWidth >= win.innerWidth * threshold) && (element.clientHeight >= win.innerHeight * threshold) && (style && style.getPropertyValue("z-index") >= BACKDROP_THRESHOLD_ZINDEX);
			if (fullScreen) {
				element.setAttribute(markerRemovedContent, "");
			}
		}

		function getCandidateElements() {
			return Array.from(doc.elementsFromPoint(win.innerWidth / 2, win.innerHeight / 2)).filter(element => element.tagName.toLowerCase() != MASK_TAGNAME && element.getAttribute(markerRemovedContent) == null);
		}
	}

	function markHiddenCandidates(win, element, markerRemovedContent, removedCandidates, ignoredTags, cacheElementsHidden) {
		const elements = Array.from(element.childNodes).filter(node => node.nodeType == win.Node.ELEMENT_NODE);
		elements.forEach(element => markHiddenCandidates(win, element, markerRemovedContent, removedCandidates, ignoredTags, cacheElementsHidden));
		if (elements.length) {
			const hiddenCandidate = !elements.find(element => !removedCandidates.has(element));
			if (hiddenCandidate) {
				if (hiddenElement(win, element, ignoredTags, cacheElementsHidden) && element instanceof win.HTMLElement) {
					removedCandidates.add(element);
					elements.forEach(element => {
						if (element instanceof win.HTMLElement) {
							element.setAttribute(markerRemovedContent, "");
						}
					});
				}
			}
		} else if (hiddenElement(win, element, ignoredTags, cacheElementsHidden)) {
			removedCandidates.add(element);
		}
	}

	function markHiddenElements(win, element, markerRemovedContent) {
		const elements = Array.from(element.childNodes).filter(node => node.nodeType == win.Node.ELEMENT_NODE);
		elements.forEach(element => markHiddenElements(win, element, markerRemovedContent));
		if (element.parentElement.getAttribute(REMOVED_CONTENT_ATTRIBUTE_NAME) != "") {
			element.removeAttribute(REMOVED_CONTENT_ATTRIBUTE_NAME);
		}
	}

	function hiddenElement(win, element, ignoredTags, cacheElementsHidden) {
		const hidden = testHiddenElement(win, element, ignoredTags, cacheElementsHidden);
		if (!hidden) {
			let parentElement = element.parentElement;
			if (parentElement) {
				let parentElementHidden = testHiddenElement(win, parentElement, ignoredTags, cacheElementsHidden);
				while (parentElement && !parentElementHidden) {
					parentElement = parentElement.parentElement;
					if (parentElement) {
						parentElementHidden = testHiddenElement(win, parentElement, ignoredTags, cacheElementsHidden);
					}
				}
				return parentElementHidden;
			}
		}
		return hidden;
	}

	function testHiddenElement(win, element, ignoredTags, cacheElementsHidden) {
		let hidden = cacheElementsHidden.get(element);
		if (hidden === undefined) {
			if (!ignoredTags.includes(element.tagName)) {
				hidden = element.hidden;
				if (!hidden) {
					const style = win.getComputedStyle(element);
					if (style) {
						hidden = style.display == "none";
						if (!hidden && (style.opacity == "0" || style.visibility == "hidden")) {
							const boundingRect = element.getBoundingClientRect();
							hidden = !boundingRect.width && !boundingRect.height;
						}
					}
				}
				cacheElementsHidden.set(element, hidden);
			}
			hidden = Boolean(hidden);
		}
		return hidden;
	}

	function postProcessDoc(doc, options) {
		doc.querySelectorAll("disabled-noscript").forEach(element => {
			const noscriptElement = doc.createElement("noscript");
			Array.from(element.childNodes).forEach(node => noscriptElement.appendChild(node));
			element.parentElement.replaceChild(noscriptElement, element);
		});
		doc.head.querySelectorAll("*:not(base):not(link):not(meta):not(noscript):not(script):not(style):not(template):not(title)").forEach(element => element.removeAttribute("hidden"));
		if (options.removeHiddenElements) {
			doc.querySelectorAll("[" + removedContentAttributeName(options.sessionId) + "]").forEach(element => element.removeAttribute(removedContentAttributeName(options.sessionId)));
		}
		if (options.compressHTML) {
			doc.querySelectorAll("[" + preservedSpaceAttributeName(options.sessionId) + "]").forEach(element => element.removeAttribute(preservedSpaceAttributeName(options.sessionId)));
		}
		doc.querySelectorAll("[" + responsiveImagesAttributeName(options.sessionId) + "]").forEach(element => element.removeAttribute(responsiveImagesAttributeName(options.sessionId)));
		doc.querySelectorAll("[" + imagesAttributeName(options.sessionId) + "]").forEach(element => element.removeAttribute(imagesAttributeName(options.sessionId)));
		doc.querySelectorAll("[" + inputValueAttributeName(options.sessionId) + "]").forEach(element => element.removeAttribute(inputValueAttributeName(options.sessionId)));
	}

	function responsiveImagesAttributeName(sessionId) {
		return RESPONSIVE_IMAGE_ATTRIBUTE_NAME + (sessionId ? "-" + sessionId : "");
	}

	function imagesAttributeName(sessionId) {
		return IMAGE_ATTRIBUTE_NAME + (sessionId || "");
	}

	function preservedSpaceAttributeName(sessionId) {
		return PRESERVED_SPACE_ELEMENT_ATTRIBUTE_NAME + (sessionId || "");
	}

	function removedContentAttributeName(sessionId) {
		return REMOVED_CONTENT_ATTRIBUTE_NAME + (sessionId || "");
	}

	function windowIdAttributeName(sessionId) {
		return WIN_ID_ATTRIBUTE_NAME + (sessionId || "");
	}

	function inputValueAttributeName(sessionId) {
		return INPUT_VALUE_ATTRIBUTE_NAME + (sessionId || "");
	}

	function sheetAttributeName(sessionId) {
		return SHEET_ATTRIBUTE_NAME + (sessionId || "");
	}

	function getCanvasData(doc, win) {
		if (doc) {
			const canvasData = [];
			doc.querySelectorAll("canvas").forEach(canvasElement => {
				try {
					const size = getSize(win, canvasElement);
					canvasData.push({ dataURI: canvasElement.toDataURL("image/png", ""), width: size.width, height: size.height });
				} catch (error) {
					canvasData.push(null);
				}
			});
			return canvasData;
		}
	}

	function getStylesheetContents(doc) {
		if (doc) {
			const contents = [];
			doc.querySelectorAll("style").forEach((styleElement, styleIndex) => {
				let stylesheet;
				try {
					const tempStyleElement = doc.createElement("style");
					tempStyleElement.textContent = styleElement.textContent;
					doc.body.appendChild(tempStyleElement);
					stylesheet = tempStyleElement.sheet;
					tempStyleElement.remove();
					if (!stylesheet || stylesheet.cssRules.length != styleElement.sheet.cssRules.length) {
						contents[styleIndex] = Array.from(styleElement.sheet.cssRules).map(rule => rule.cssText).join("\n");
					}
				} catch (error) {
					/* ignored */
				}
			});
			return contents;
		}
	}

	function getImageData(doc, win, options) {
		if (doc) {
			const data = [];
			doc.querySelectorAll("img[src]:not([srcset])").forEach((imageElement, imageElementIndex) => {
				const computedStyle = win.getComputedStyle(imageElement);
				let imageData = {};
				if (computedStyle) {
					let size = getSize(win, imageElement);
					if (imageElement.src && size && (!computedStyle.getPropertyValue("background-image") || computedStyle.getPropertyValue("background-image") == "none")) {
						imageElement.setAttribute(imagesAttributeName(options.sessionId), imageElementIndex);
						imageData = size;
						imageData.objectFit = computedStyle.getPropertyValue("object-fit");
						imageData.objectPosition = computedStyle.getPropertyValue("object-position");
					}
				}
				data.push(imageData);
			});
			return data;
		}
	}

	function getSize(win, imageElement) {
		const computedStyle = win.getComputedStyle(imageElement);
		let paddingLeft, paddingRight, paddingTop, paddingBottom, borderLeft, borderRight, borderTop, borderBottom;
		paddingLeft = getWidth("padding-left", computedStyle);
		paddingRight = getWidth("padding-right", computedStyle);
		paddingTop = getWidth("padding-top", computedStyle);
		paddingBottom = getWidth("padding-bottom", computedStyle);
		borderLeft = getWidth("border-left-width", computedStyle);
		borderRight = getWidth("border-right-width", computedStyle);
		borderTop = getWidth("border-top-width", computedStyle);
		borderBottom = getWidth("border-bottom-width", computedStyle);
		const width = imageElement.clientWidth;
		const height = imageElement.clientHeight;
		if (width >= 0 && height >= 0 && paddingLeft >= 0 && paddingRight >= 0 && paddingTop >= 0 && paddingBottom >= 0 && borderLeft >= 0 && borderRight >= 0 && borderTop >= 0 && borderBottom >= 0) {
			return {
				width: (paddingLeft || paddingRight || borderLeft || borderRight) && (width - paddingLeft - paddingRight - borderLeft - borderRight) + "px",
				pxWidth: Math.round(width - paddingLeft - paddingRight - borderLeft - borderRight),
				height: (paddingTop || paddingBottom || borderTop || borderBottom) && (height - paddingTop - paddingBottom - borderTop - borderBottom) + "px",
				pxHeight: Math.round(height - paddingTop - paddingBottom - borderTop - borderBottom),
			};
		}
	}

	function getWidth(styleName, computedStyle) {
		if (computedStyle.getPropertyValue(styleName).endsWith("px")) {
			return parseFloat(computedStyle.getPropertyValue(styleName));
		}
	}

	function getResponsiveImageData(doc, options) {
		if (doc) {
			const data = [];
			doc.querySelectorAll("picture, img[srcset]").forEach((element, elementIndex) => {
				const tagName = element.tagName.toLowerCase();
				let imageData = {}, imageElement;
				element.setAttribute(responsiveImagesAttributeName(options.sessionId), elementIndex);
				if (tagName == "picture") {
					const sources = Array.from(element.querySelectorAll("source")).map(sourceElement => (
						{ src: sourceElement.src, srcset: sourceElement.srcset }
					));
					imageElement = element.querySelector("img");
					imageData.sources = sources;
				}
				if (tagName == "img") {
					imageElement = element;
				}
				if (imageElement) {
					let naturalWidth = imageElement.naturalWidth, naturalHeight = imageElement.naturalHeight;
					if (naturalWidth <= 1 && naturalHeight <= 1) {
						const imgElement = doc.createElement("img");
						imgElement.src = imageElement.src;
						doc.body.appendChild(imgElement);
						naturalWidth = imgElement.width;
						naturalHeight = imgElement.height;
						imgElement.remove();
					}
					imageData.source = {
						clientWidth: imageElement.clientWidth,
						clientHeight: imageElement.clientHeight,
						naturalWidth: naturalWidth,
						naturalHeight: naturalHeight,
						width: imageElement.width,
						height: imageElement.height,
						src: (!imageElement.currentSrc.startsWith("data:") && imageElement.currentSrc) || (!imageElement.src.startsWith("data:") && imageElement.src)
					};
				}
				data.push(imageData);
			});
			return data;
		}
	}

	function getPostersData(doc) {
		if (doc) {
			const postersData = [];
			doc.querySelectorAll("video").forEach(videoElement => {
				if (videoElement.poster) {
					postersData.push(null);
				} else {
					const canvasElement = doc.createElement("canvas");
					const context = canvasElement.getContext("2d");
					canvasElement.width = videoElement.clientWidth;
					canvasElement.height = videoElement.clientHeight;
					try {
						context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
						postersData.push(canvasElement.toDataURL("image/png", ""));
					} catch (error) {
						postersData.push(null);
					}
				}
			});
			return postersData;
		}
	}

	function getFontsData() {
		if (typeof fontFaceProxy != "undefined") {
			return fontFaceProxy.getFontsData();
		}
	}

	function retrieveInputValues(doc, options) {
		doc.querySelectorAll("input").forEach(input => input.setAttribute(inputValueAttributeName(options.sessionId), input.value));
		doc.querySelectorAll("textarea").forEach(textarea => textarea.setAttribute(inputValueAttributeName(options.sessionId), textarea.value));
		doc.querySelectorAll("select").forEach(select => {
			select.querySelectorAll("option").forEach(option => {
				if (option.selected) {
					option.setAttribute(inputValueAttributeName(options.sessionId), "");
				}
			});
		});
	}

	function serialize(doc) {
		const docType = doc.doctype;
		let docTypeString = "";
		if (docType) {
			docTypeString = "<!DOCTYPE " + docType.nodeName;
			if (docType.publicId) {
				docTypeString += " PUBLIC \"" + docType.publicId + "\"";
				if (docType.systemId) {
					docTypeString += " \"" + docType.systemId + "\"";
				}
			} else if (docType.systemId) {
				docTypeString += " SYSTEM \"" + docType.systemId + "\"";
			} if (docType.internalSubset) {
				docTypeString += " [" + docType.internalSubset + "]";
			}
			docTypeString += "> ";
		}
		return docTypeString + doc.documentElement.outerHTML;
	}

})();