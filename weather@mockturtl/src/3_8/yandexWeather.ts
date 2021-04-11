//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
///////////                                       ////////////
///////////             Yandex Weather            ////////////
///////////                                       ////////////
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////

import { HttpError } from "./httpLib";
import { Log } from "./logger";
import { WeatherApplet } from "./main";
import { WeatherProvider, WeatherData, ForecastData, HourlyForecastData, AppletError, BuiltinIcons, CustomIcons, LocationData, ImmediatePrecipitation, Condition } from "./types";
import { _, IsLangSupported } from "./utils";

const Lang: typeof imports.lang = imports.lang;

export class YandexWeather implements WeatherProvider {
	//--------------------------------------------------------
	//  Properties
	//--------------------------------------------------------
	public readonly prettyName = "Yandex.Weather";
	public readonly name = "YandexWeather";
	 //FixMe Need to investigate
	public readonly maxForecastSupport = 8;
	public readonly website = "https://yandex.com/weather";
	 //FixMe Need to investigate
	public readonly maxHourlyForecastSupport = 48;
	public readonly needsApiKey = true;

	private supportedLanguages = ["af", "al", "ar", "az", "bg", "ca", "cz", "da", "de", "el", "en", "eu", "fa", "fi",
		"fr", "gl", "he", "hi", "hr", "hu", "id", "it", "ja", "kr", "la", "lt", "mk", "no", "nl", "pl",
		"pt", "pt_br", "ro", "ru", "se", "sk", "sl", "sp", "es", "sr", "th", "tr", "ua", "uk", "vi", "zh_cn", "zh_tw", "zu"
	];

	private defaultApiLocale = "en_US";
	private supportedLanguagesMap: { [id: string] : string; } = {
		"ru"		:"ru_RU",
		"ru-ru"		:"ru_RU",
		"ru-ua"		:"ru_UA",
		"uk"		:"uk_UA",
		"uk-ua"		:"uk_UA",
		"be-by"		:"be_BY",
		"kk-kz"		:"kk_KZ",
		"tr-tr"		:"tr_TR",
		"en-us"		:"en_US",
		"en"		:"en_US"
	};

	// API docs: https://yandex.com/dev/weather/doc/dg/concepts/forecast-test.html
	// ?lat=<latitude>&lon=<longitude>&[lang=<response language>]
	// Headers:
	// X-Yandex-API-Key: <key value>
	private base_url = "https://api.weather.yandex.ru/v2/informers?"

	private app: WeatherApplet
	constructor(_app: WeatherApplet) {
		this.app = _app;
	}

	//--------------------------------------------------------
	//  Functions
	//--------------------------------------------------------

	public async GetWeather(loc: LocationData): Promise<WeatherData> {
		let query = this.ConstructQuery(this.base_url, loc);
		var headers = this.ConstructHeaders();

		let json = await this.app.LoadJsonAsync<any>(query, null, Lang.bind(this, this.HandleError), "GET", headers);
		if (!json){
			return null;
		}

		//FixMe need to investigate YandexApi Behavior
		if (this.HadErrors(json)) {
			return null;
		}

		//FixMe need to investigate YandexApi model
		return this.ParseWeather(json);
	};

	private ParseWeather(json: any): WeatherData {
		const yandexWeatherProvider = this;

		try {
			const weather = this.ParseYandexWeatherResponse(json)
			return weather;
		} catch (e) {
			Log.Instance.Error("OpenWeatherMap Weather Parsing error: " + e);
			yandexWeatherProvider.app.ShowError({
				type: "soft",
				service: "openweathermap",
				detail: "unusual payload",
				message: _("Failed to Process Current Weather Info")
			})
			return null;
		}
	};

	private ParseYandexWeatherResponse(json: any){
		if (!json){
			return null;
		}

		const basePart = this.ParseBaseData(json);
		const coordPart = this.ParseCoordinates(json);
		const locationPart = this.ParseLocationPart(json);
		const windPart = this.ParseWindPart(json);
		const conditionPart = this.ParseCondition(json);

		// The variable type helps check if created object suites WeatherData interface
		const weather: WeatherData = {
			...basePart,
			...coordPart,
			...locationPart,
			...windPart,
			...conditionPart,

			//Todo Add forecasts parsing
			forecasts: [],

			//Todo Investigate how sunset/sunrise data can be parsed. Maybe forecast sunset/sunrise of now() if possible
			sunset: null,
			sunrise: null,
		};

		return weather;
	}

	private ParseBaseData(json: any){
		if (!json || !(json.fact)){
			return null;
		}

		const { temp, pressure_pa, humidity, obs_time} = json.fact;

		const tempK = this.ConvertCelsiusToKelvin(temp);

		return {
			date: obs_time,
			// Todo Yandex.Weather don't provide sunset/sunrise for fact condition; it is in forecasts only
			// sunrise: Date,
			// sunset: Date,
			temperature: tempK,
			pressure: pressure_pa,
			humidity: humidity,
		};
	}

	private ParseCoordinates(json: any){
		if (!json || !(json.info)){
			return;
		}

		const { lat, lon} = json.info;

		return {
			coord: {
				lat: lat,
				lon: lon
			}
		}
	}

	private ParseLocationPart(json: any){
		if (!json || !(json.info)){
			return null;
		}

		const {url, tzinfo: {name, offset}} = json.info;
		return {
			location: {
				// city?: string,
				// country?: string,
				timeZone: name,
				url: url,
				/** in metres */
				// distanceFrom?: number,
				tzOffset: offset
			}
		}
	}

	private ParseWindPart(json: any){
		if (!json || !(json.fact)){
			return null;
		}

		const { wind_speed, wind_dir } = json.fact;
		const wind_degree = this.GetWindDegree(wind_dir);

		return {
			wind: {
				speed: wind_speed,
				degree: wind_degree,
			}
		}
	}

	private ParseCondition(json: any){
		if (!json || !(json.fact)){
			return null;
		}

		const { condition: yandexCondition, prec_type, daytime, phenom_condition } = json.fact;

		const conditionBuilder = this._mapConditionBuilders[yandexCondition]
								|| this._mapConditionBuilders[this._defaultConditionBuilderKey];

		const condition = conditionBuilder(yandexCondition, prec_type, daytime, phenom_condition);

		return {
			condition: condition
		}
	};

	private _defaultCustomIcon:CustomIcons = "na-symbolic";

	// FixMe Add custom icon mapping
	private _defaultConditionBuilderKey = "default";
	private _mapConditionBuilders: {
		[key: string]: (condition:string, prec_type:string, daytime:string, phenom_condition: string) => Condition
	} = {
		"default": () => ({
			main: "Unknown",
			description: "Unknown",
			icons: ["weather-clear"],
			customIcon: this._defaultCustomIcon,
		}),
		"clear": (daytime) => {
			const icons:BuiltinIcons[] = this.IsDaytime(daytime)
				? ["weather-clear"]
				: ["weather-clear-night"];

			return {
				main: "Clear",
				description: "Clear",
				icons: icons,
				customIcon: this._defaultCustomIcon,
			}
		},
		"showers": (daytime) => {
			const icons:BuiltinIcons[] = [
				"weather-showers",
				(this.IsDaytime(daytime) ? "weather-showers-day" : "weather-showers-night"),
			];

			return {
				main: "Showers",
				description: "Showers",
				icons: icons,
				customIcon: this._defaultCustomIcon,
			}
		},

		// Todo Add the next condition builder

		// [*] clear — Clear.
		// [ ] partly-cloudy — Partly cloudy.
		// [ ] cloudy — Cloudy.
		// [ ] overcast — Overcast.
		// [ ] drizzle — Drizzle.
		// [ ] light-rain — Light rain.
		// [ ] rain — Rain.
		// [ ] moderate-rain — Moderate rain.
		// [ ] heavy-rain — Heavy rain.
		// [ ] continuous-heavy-rain — Continuous heavy rain.
		// [*] showers — Showers.
		// [ ] wet-snow — Sleet.
		// [ ] light-snow — Light snow.
		// [ ] snow — Snow.
		// [ ] snow-showers — Snowfall.
		// [ ] hail — Hail.
		// [ ] thunderstorm — Thunderstorm.
		// [ ] thunderstorm-with-rain — Rain, thunderstorm.
		// [ ] thunderstorm-with-hail — Thunderstorm, hail.
	};

	// Meteorological wind direction is defined as the direction from which it originates.
	// For example, a northerly wind blows from the north to the south.
	// Wind direction is measured in degrees clockwise from due north.
	// Hence, a wind coming from the south has a wind direction of 180 degrees; one from the east is 90 degrees.
	// Origin : https://www.ncl.ucar.edu/Document/Functions/Contributed/wind_direction.shtml#:~:text=Meteorological%20wind%20direction%20is%20defined,the%20east%20is%2090%20degrees.
	private GetWindDegree(yandexWindDirection: string): number{
		switch(yandexWindDirection) {
			default:
			case "c": // c is for "calm", means "no wind"
			case "n":	return 0;
			case "ne":	return 45;
			case "e":	return 90;
			case "se":	return 135;
			case "s":	return 180;
			case "sw":	return 225;
			case "w":	return 270;
			case "nw":	return 315;
		 }
	};

	private ConstructQuery(baseUrl: string, loc: LocationData): string {
		let query = baseUrl;
		const locale: string = this.ConvertToAPILocale(this.app.config.currentLocale);

		query = query + "lat=" + loc.lat + "&lon=" + loc.lon
		// Append Language if supported and enabled
		if (this.app.config._translateCondition) {
			query = query + "&lang=" + locale;
		}

		return query;
	};

	private ConstructHeaders(): {[key: string]: string}{
		const apiKey = this.app.config.ApiKey;
		return {
			"X-Yandex-API-Key": apiKey
		}
	};

	private ConvertToAPILocale(systemLocale: string) {
		let apiLocale = systemLocale && this.supportedLanguagesMap[systemLocale];

		if (!apiLocale){
			apiLocale = this.defaultApiLocale
		}

		return apiLocale;
	};

	private ConvertCelsiusToKelvin(value: number): number{
		return value + 273.15;
	};

	private IsDaytime(value: string): boolean {
		return value && value === "d";
	}

	private HadErrors(json: any): boolean {
		if (!this.HasReturnedError(json)) return false;
		let errorMsg = "OpenWeatherMap Response: ";
		let error = {
			service: "openweathermap",
			type: "hard",
		} as AppletError;
		let errorPayload: OpenWeatherMapError = json;
		switch (errorPayload.cod) {
			case ("400"):
				error.detail = "bad location format";
				error.message = _("Please make sure Location is in the correct format in the Settings");
				break;
			case ("401"):
				error.detail = "bad key";
				error.message = _("Make sure you entered the correct key in settings");
				break;
			case ("404"):
				error.detail = "location not found";
				error.message = _("Location not found, make sure location is available or it is in the correct format");
				break;
			case ("429"):
				error.detail = "key blocked";
				error.message = _("If this problem persists, please contact the Author of this applet");
				break;
			default:
				error.detail = "unknown";
				error.message = _("Unknown Error, please see the logs in Looking Glass");
				break;
		};
		this.app.ShowError(error);
		Log.Instance.Debug("OpenWeatherMap Error Code: " + errorPayload.cod)
		Log.Instance.Error(errorMsg + errorPayload.message);
		return true;
	};

	private HasReturnedError(json: any) {
		return (!!json?.cod);
	};

	public HandleError(error: HttpError): boolean {
		if (error.code == 404) {
			this.app.ShowError({
				detail: "location not found",
				message: _("Location not found, make sure location is available or it is in the correct format"),
				userError: true,
				type: "hard"
			})
			return false;
		}
		return true;
	}
};

interface OpenWeatherMapError {
	cod: string;
	message: string;
}

const openWeatherMapConditionLibrary = [
	// Group 2xx: Thunderstorm
	_("Thunderstorm with light rain"),
	_("Thunderstorm with rain"),
	_("Thunderstorm with heavy rain"),
	_("Light thunderstorm"),
	_("Thunderstorm"),
	_("Heavy thunderstorm"),
	_("Ragged thunderstorm"),
	_("Thunderstorm with light drizzle"),
	_("Thunderstorm with drizzle"),
	_("Thunderstorm with heavy drizzle"),
	// Group 3xx: Drizzle
	_("Light intensity drizzle"),
	_("Drizzle"),
	_("Heavy intensity drizzle"),
	_("Light intensity drizzle rain"),
	_("Drizzle rain"),
	_("Heavy intensity drizzle rain"),
	_("Shower rain and drizzle"),
	_("Heavy shower rain and drizzle"),
	_("Shower drizzle"),
	// Group 5xx: Rain
	_("Light rain"),
	_("Moderate rain"),
	_("Heavy intensity rain"),
	_("Very heavy rain"),
	_("Extreme rain"),
	_("Freezing rain"),
	_("Light intensity shower rain"),
	_("Shower rain"),
	_("Heavy intensity shower rain"),
	_("Ragged shower rain"),
	// Group 6xx: Snow
	_("Light snow"),
	_("Snow"),
	_("Heavy snow"),
	_("Sleet"),
	_("Shower sleet"),
	_("Light rain and snow"),
	_("Rain and snow"),
	_("Light shower snow"),
	_("Shower snow"),
	_("Heavy shower snow"),
	// Group 7xx: Atmosphere
	_("Mist"),
	_("Smoke"),
	_("Haze"),
	_("Sand, dust whirls"),
	_("Fog"),
	_("Sand"),
	_("Dust"),
	_("Volcanic ash"),
	_("Squalls"),
	_("Tornado"),
	// Group 800: Clear
	_("Clear"),
	_("Clear sky"),
	_("Sky is clear"),
	// Group 80x: Clouds
	_("Clouds"),
	_("Few clouds"),
	_("Scattered clouds"),
	_("Broken clouds"),
	_("Overcast clouds")
];