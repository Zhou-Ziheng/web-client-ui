function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/* eslint class-methods-use-this: "off" */
import dh from '@deephaven/jsapi-shim';
import Log from '@deephaven/log';
import TableColumnFormatter from "./TableColumnFormatter.js";
var log = Log.module('IntegerColumnFormatter');

/** Column formatter for integers/whole numbers */
export class IntegerColumnFormatter extends TableColumnFormatter {
  /**
   * Validates format object
   * @param format Format object
   * @returns true for valid object
   */
  static isValid(format) {
    try {
      dh.i18n.NumberFormat.format(format.formatString, 0);
      return true;
    } catch (e) {
      return false;
    }
  }
  /**
   * Create an IntegerColumnFormat object with the parameters specified
   * @param label Label for the format
   * @param formatString Format string for the format
   * @param multiplier Optional multiplier for the formatter
   * @param type Type of format created
   * @returns IntegerColumnFormat object
   */


  static makeFormat(label, formatString) {
    var type = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : TableColumnFormatter.TYPE_CONTEXT_PRESET;
    var multiplier = arguments.length > 3 ? arguments[3] : undefined;
    return {
      label,
      type,
      formatString,
      multiplier
    };
  }
  /**
   * Convenient function to create a IntegerFormatObject with Preset type set
   * @param label Label for this format object
   * @param formatString Format string to use
   * @param multiplier Multiplier to use
   * @returns IntegerColumnFormat object
   */


  static makePresetFormat(label) {
    var formatString = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
    var multiplier = arguments.length > 2 ? arguments[2] : undefined;
    return IntegerColumnFormatter.makeFormat(label, formatString, TableColumnFormatter.TYPE_CONTEXT_PRESET, multiplier);
  }
  /**
   * Convenient function to create a IntegerFormatObject with a default 'Custom Format' label and Custom type
   * @param formatString Format string to use
   * @param multiplier Multiplier to use
   * @returns IntegerColumnFormat object
   */


  static makeCustomFormat() {
    var formatString = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
    var multiplier = arguments.length > 1 ? arguments[1] : undefined;
    return IntegerColumnFormatter.makeFormat('Custom Format', formatString, TableColumnFormatter.TYPE_CONTEXT_CUSTOM, multiplier);
  }
  /**
   * Check if the given formats match
   * @param formatA format object to check
   * @param formatB format object to check
   * @returns True if the formats match
   */


  static isSameFormat(formatA, formatB) {
    return formatA === formatB || formatA != null && formatB != null && formatA.type === formatB.type && formatA.formatString === formatB.formatString && formatA.multiplier === formatB.multiplier;
  }

  constructor() {
    var {
      defaultFormatString = IntegerColumnFormatter.DEFAULT_FORMAT_STRING
    } = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    super();

    _defineProperty(this, "defaultFormatString", void 0);

    this.defaultFormatString = defaultFormatString;
  }
  /**
   * Format a value with the provided format object
   * @param valueParam Value to format
   * @param format Format object
   * @returns Formatted string
   */


  format(valueParam, format) {
    var formatString = format && format.formatString || this.defaultFormatString;
    var value = format && format.multiplier ? valueParam * format.multiplier : valueParam;

    try {
      return dh.i18n.NumberFormat.format(formatString, value);
    } catch (e) {
      log.error('Invalid format arguments');
    }

    return '';
  }

}

_defineProperty(IntegerColumnFormatter, "DEFAULT_FORMAT_STRING", '###,##0');

_defineProperty(IntegerColumnFormatter, "FORMAT_MILLIONS", IntegerColumnFormatter.makePresetFormat('Millions', '###,##0.000 mm', 0.000001));

export default IntegerColumnFormatter;
//# sourceMappingURL=IntegerColumnFormatter.js.map