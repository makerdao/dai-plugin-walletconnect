import WalletConnectSubprovider from '@walletconnect/web3-subprovider';
import debug from 'debug';
const log = debug('dai:plugin:walletconnect');

const ACCOUNT_TYPE_WALLETCONNECT = 'walletconnect';

export default function (maker, _, pluginConfig = {}) {
  log('Plugin initialized');

  maker.service('accounts', true).addAccountType(ACCOUNT_TYPE_WALLETCONNECT, (settings) => {
    const subprovider = new WalletConnectSubprovider({ bridge: 'https://bridge.walletconnect.org' });
    const waitForInitialUpdateTime = pluginConfig.waitForInitialUpdateTime || 1000;

    return new Promise(async (resolve, reject) => {
      const existingSession = subprovider.accounts.length !== 0;
      if (existingSession) log('Using existing session');
      else log('Creating new session');

      let wc;
      try {
        wc = await subprovider.getWalletConnector();
      } catch (err) {
        window.wc = subprovider;
        if (subprovider._walletConnector._transport.connected) await subprovider._walletConnector.killSession();
        return reject(err);
      }
      let address = wc.accounts[0].toLocaleLowerCase();
      let chainId = wc.chainId;

      let waitForSessionUpdate = null;
      if (existingSession && waitForInitialUpdateTime) {
        log(`Waiting ${waitForInitialUpdateTime}ms for initial session update`);
        waitForSessionUpdate = setTimeout(() => {
          waitForSessionUpdate = null;
          log(`Initial session update timed out, using cached address ${address} and chainId ${chainId}`);
          subprovider.chainId = chainId; // HACK: WalletConnect needs to fix this
          resolve({ subprovider, address, chainId });
        }, waitForInitialUpdateTime);
      } else {
        subprovider.chainId = chainId; // HACK: WalletConnect needs to fix this
        log(`Using address ${address} and chainId ${chainId}`);
        resolve({ subprovider, address, chainId });
      }

      wc.on('session_update', (error, payload) => {
        log('Got session update', error, payload);

        if (payload?.event === 'session_update') {
          const updatedAddress = payload.params[0]?.accounts[0]?.toLowerCase() || null;
          const updatedChainId = payload.params[0]?.chainId || null;
          if (waitForSessionUpdate) {
            clearTimeout(waitForSessionUpdate);
            waitForSessionUpdate = null;
            log(`Got initial session update, using changed address ${updatedAddress} and chainId ${updatedChainId}`);
            address = updatedAddress;
            chainId = updatedChainId;
            subprovider.chainId = chainId; // HACK: WalletConnect needs to fix this
            return resolve({ subprovider, address: updatedAddress, chainId: updatedChainId });
          }
          if (address !== updatedAddress) {
            log(`Wallet address changed to ${updatedAddress}`);
            address = updatedAddress;
            subprovider.engine.emit('accountsChanged', [updatedAddress]);
          }
          if (chainId !== updatedChainId) {
            log(`Wallet chainId changed to ${updatedChainId}`);
            chainId = updatedChainId;
            subprovider.chainId = chainId; // HACK: WalletConnect needs to fix this
            subprovider.engine.emit('chainChanged', updatedChainId);
            subprovider.engine.emit('networkChanged', updatedChainId);
          }
        }
      });
    });
  });
}
