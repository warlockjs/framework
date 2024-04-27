import { BasicLogConfigurations, LogContract, LogLevel } from "./types";

export abstract class LogChannel<
  Options extends BasicLogConfigurations = BasicLogConfigurations
> implements LogContract
{
  /**
   * Channel name
   */
  public name!: string;

  /**
   * Channel description
   */
  public description?: string;

  /**
   * Determine if channel is logging in terminal
   */
  public terminal = false;

  /**
   * Default Configurations
   */
  protected defaultConfigurations: Options = {} as Options;

  /**
   * Channel configurations
   */
  protected channelConfigurations: Options = {} as Options;

  /**
   * Get config value
   */
  protected config<K extends keyof Options>(key: K): Options[K] {
    return this.channelConfigurations[key] ?? this.defaultConfigurations[key];
  }

  /**
   * Constructor
   */
  public constructor(configurations?: Options) {
    if (configurations) {
      this.setConfigurations(configurations);
    }

    this.init();
  }

  /**
   * Set configurations
   */
  protected setConfigurations(configurations: Options) {
    this.channelConfigurations = {
      ...this.channelConfigurations,
      ...configurations,
    };

    return this;
  }

  /**
   * Initialize channel
   */
  protected async init(): Promise<void> {
    //
  }

  /**
   * Determine if the message should be logged
   */
  protected shouldBeLogged({
    module,
    action,
    level,
  }: {
    module: string;
    action: string;
    level: LogLevel;
  }): boolean {
    // check for debug mode
    const allowedLevels = this.config("levels");

    if (allowedLevels?.length && !allowedLevels.includes(level)) return false;

    const filter = this.config("filter");

    if (filter) {
      return filter({ level, module, action });
    }

    return true;
  }

  /**
   * Log the given message
   */
  public abstract log(
    module: string,
    action: string,
    message: any,
    level: LogLevel
  ): void | Promise<void>;
}
