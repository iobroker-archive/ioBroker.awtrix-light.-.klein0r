import { AwtrixLight } from '../../main';
import { HistoryApp } from '../adapter-config';
import { AwtrixApi } from '../api';
import { AppType as AbstractAppType } from './abstract';

export namespace AppType {
    export class History extends AbstractAppType.AbstractApp {
        private appDefinition: HistoryApp;
        private isValidSourceInstance: boolean;
        private isValidObjId: boolean;

        public constructor(apiClient: AwtrixApi.Client, adapter: AwtrixLight, definition: HistoryApp) {
            super(apiClient, adapter, definition);

            this.appDefinition = definition;
            this.isValidSourceInstance = false;
            this.isValidObjId = false;
        }

        public override async init(): Promise<boolean> {
            if (this.appDefinition.sourceInstance) {
                const sourceInstanceObj = await this.adapter.getForeignObjectAsync(`system.adapter.${this.appDefinition.sourceInstance}`);

                if (sourceInstanceObj && sourceInstanceObj.common?.getHistory) {
                    const sourceInstanceAliveState = await this.adapter.getForeignStateAsync(`system.adapter.${this.appDefinition.sourceInstance}.alive`);

                    if (sourceInstanceAliveState && sourceInstanceAliveState.val) {
                        this.adapter.log.debug(`[initHistoryApp] Found valid source instance for history data: ${this.appDefinition.sourceInstance}`);

                        this.isValidSourceInstance = true;
                    } else {
                        this.adapter.log.warn(`[initHistoryApp] Unable to get history data of "${this.appDefinition.sourceInstance}": instance not running (stopped)`);
                    }
                } else {
                    this.adapter.log.warn(`[initHistoryApp] Unable to get history data of "${this.appDefinition.sourceInstance}": no valid source for getHistory()`);
                }
            }

            if (this.appDefinition.objId) {
                this.adapter.log.debug(`[initHistoryApp] getting history data for app "${this.appDefinition.name}" of "${this.appDefinition.objId}" from ${this.appDefinition.sourceInstance}`);

                try {
                    if (this.isValidSourceInstance) {
                        const sourceObj = await this.adapter.getForeignObjectAsync(this.appDefinition.objId);

                        if (sourceObj && Object.prototype.hasOwnProperty.call(sourceObj?.common?.custom ?? {}, this.appDefinition.sourceInstance)) {
                            this.isValidObjId = true;
                        } else {
                            this.adapter.log.info(
                                `[initHistoryApp] Unable to get data for app "${this.appDefinition.name}" of "${this.appDefinition.objId}": logging is not configured for this object`,
                            );
                        }
                    } else {
                        this.adapter.log.info(`[initHistoryApp] Unable to get data for app "${this.appDefinition.name}" of "${this.appDefinition.objId}": source invalid or unavailable`);
                    }
                } catch (error) {
                    this.adapter.log.error(`[initHistoryApp] Unable to get data for app "${this.appDefinition.name}" of "${this.appDefinition.objId}": ${error}`);
                }
            }

            return super.init();
        }

        private override async refresh(): Promise<boolean> {
            let refreshed = false;

            if ((await super.refresh()) && this.isValidSourceInstance && this.isValidObjId) {
                const itemCount = this.appDefinition.icon ? 11 : 16; // Can display 11 values with icon or 16 values without icon

                const historyData = await this.adapter.sendToAsync(this.appDefinition.sourceInstance, 'getHistory', {
                    id: this.appDefinition.objId,
                    options: {
                        start: 1,
                        end: Date.now(),
                        aggregate: 'none',
                        limit: itemCount,
                        returnNewestEntries: true,
                        ignoreNull: 0,
                        removeBorderValues: true,
                        ack: true,
                    },
                });
                const lineData = (historyData as any)?.result
                    .filter((state: ioBroker.State) => typeof state.val === 'number' && state.ack)
                    .map((state: ioBroker.State) => Math.round(state.val as number))
                    .slice(itemCount * -1);

                this.adapter.log.debug(
                    `[refreshHistoryApp] Data for app "${this.appDefinition.name}" of "${this.appDefinition.objId}: ${JSON.stringify(historyData)} - filtered: ${JSON.stringify(lineData)}`,
                );

                if (lineData.length > 0) {
                    const moreOptions: AwtrixApi.App = {};

                    // Duration
                    if (this.appDefinition.duration > 0) {
                        moreOptions.duration = this.appDefinition.duration;
                    }

                    // Repeat
                    if (this.appDefinition.repeat > 0) {
                        moreOptions.repeat = this.appDefinition.repeat;
                    }

                    await this.apiClient!.appRequestAsync(this.appDefinition.name, {
                        color: this.appDefinition.lineColor || '#FF0000',
                        background: this.appDefinition.backgroundColor || '#000000',
                        line: lineData,
                        autoscale: true,
                        icon: this.appDefinition.icon,
                        lifetime: this.adapter.config.historyAppsRefreshInterval + 60, // Remove app if there is no update in configured interval (+ buffer)
                        pos: this.appDefinition.position,
                        ...moreOptions,
                    }).catch((error) => {
                        this.adapter.log.warn(`(custom?name=${this.appDefinition.name}) Unable to create app "${this.appDefinition.name}": ${error}`);
                    });

                    refreshed = true;
                } else {
                    this.adapter.log.debug(`[refreshHistoryApp] Going to remove app "${this.appDefinition.name}" (no history data)`);

                    await this.apiClient!.removeAppAsync(this.appDefinition.name).catch((error) => {
                        this.adapter.log.warn(`[refreshHistoryApp] Unable to remove app "${this.appDefinition.name}" (no history data): ${error}`);
                    });
                }
            }

            return refreshed;
        }
    }
}