import React, { Component } from 'react'
import { ethers } from 'ethers'

import { ConnectWallet } from '../components/ConnectWallet'

import auctionAddress from '../contracts/DutchAuction-contract-address.json'
import auctionArtifact from '../contracts/DutchAuction.json'
import { WaitingForTransactionMessage } from '../components/WaitingForTransactionMessage'
import { TransactionErrorMessage } from '../components/TransactionErrorMessage'



const HARDHAT_NETWORK_ID = '31337'
const ERROR_CODE_TX_REJECTED_BY_USER = 4001

export default class extends Component {
  constructor(props) {
    super(props)

    this.initialState = {
      selectedAccount: null, // выбранный аккаунт
      txBeingSent: null, // хеш отправляемой транзакции
      networkError: null, // ошибка сети
      transactionError: null,
      balance: null, // баланс пользователя
      currentPrice: null, // текущая цена в аукционе
      stopped: false,
    }

    this.state = this.initialState
  }

    // Подключение к кошельку через MetaMask
  _connectWallet = async () => {
    if(window.ethereum === undefined) {
      this.setState({
        networkError: 'Please install Metamask!'
      })
      return
    }

    const [selectedAddress] = await window.ethereum.request({
      method: 'eth_requestAccounts'
    })

    if(!this._checkNetwork()) { return }

    this._initialize(selectedAddress)

    window.ethereum.on('accountsChanged', ([newAddress]) => {
      if(newAddress === undefined) {
        return this._resetState()
      }

      this._initialize(newAddress)
    })

    window.ethereum.on('chainChanged', ([networkId]) => {
      this._resetState()
    })
  }

  
  async _initialize(selectedAddress) {
      // Устанавливается Web3 провайдер для взаимодействия с Ethereum сетью через MetaMask
    this._provider = new ethers.providers.Web3Provider(window.ethereum)

    // Создается экземпляр контракта с использованием ABI, адреса контракта и подписчика (signer)
    this._auction = new ethers.Contract(
      auctionAddress.DutchAuction,
      auctionArtifact.abi,
      this._provider.getSigner(0)
    )

     // Установка состояния с выбранным адресом пользователя
    this.setState({
      selectedAccount: selectedAddress
      // После установки состояния, обновление баланса пользователя
    }, async () => {
      await this.updateBalance()
    })  
    // Проверка, не остановлен ли аукцион
    if(await this.updateStopped()) { return }

    this.startingPrice = await this._auction.startingPrice()
    this.startAt = ethers.BigNumber.from(await this._auction.startAt() *1000)
    this.discountRate = await this._auction.discountRate()

    // Регулярное обновление цены в аукционе
    
     // Установка интервала для регулярного обновления текущей цены
    this.checkPriceInterval = setInterval(()=> {
    const elapsed = ethers.BigNumber.from(Date.now()).sub(this.startAt)
    const discount = this.discountRate.mul(elapsed)
    const newPrice = this.startingPrice.sub(discount)
        this.setState({
            currentPrice: ethers.utils.formatEther(newPrice)
        })
    },1000)
  }


  updateStopped = async() => {
    const stopped = await this._auction.stopped()

    if (stopped){
      clearInterval(this.checkPriceInterval)
    }

    this.setState({
      stopped: stopped
    })
    return stopped
  }

  componentWillUnmount(){
    clearInterval(this.checkPriceInterval)
  }

  async updateBalance() {
    const newBalance = (await this._provider.getBalance(
      this.state.selectedAccount
    )).toString()

    this.setState({
      balance: newBalance
    })
  }

  _resetState() {
    this.setState(this.initialState)
  }

  _checkNetwork() {
    if (window.ethereum.networkVersion === HARDHAT_NETWORK_ID) { return true }

    this.setState({
      networkError: 'Please connect to localhost:8545'
    })

    return false
  }

  _dismissNetworkError = () => {
    this.setState({
      networkError: null
    })
  }

  _dismissTransactionError = () => {
    this.setState({
      transactionError: null
    })
  }

  nextBlock = async() => {
    await this._auction.nextBlock()
  }

  buy = async() => {
    //console.log((ethers.utils.parseEther(this.state.currentPrice + 1)).toString())
    try {
      // Добавляем небольшую дополнительную сумму к текущей цене для учета изменения цены
      const extraAmount = ethers.utils.parseEther('0.001');
      const totalPrice = ethers.utils.parseEther(this.state.currentPrice).add(extraAmount);

      // Отправка транзакции на функцию buy смарт-контракта
      const tx = await this._auction.buy({
        value: totalPrice
      })

       // Сохранение хэша транзакции в состоянии компонента
      this.setState({
        txBeingSent: tx.hash
      })
     // Ожидание подтверждения транзакции
      await tx.wait()
    } catch(error) {
      // Обработка ошибок (например, отказ пользователя от транзакции)
      if(error.code === ERROR_CODE_TX_REJECTED_BY_USER) { return }

      console.error(error)
       // Сохранение ошибки транзакции в состоянии
      this.setState({
        transactionError: error
      })
    } finally {
      // Очистка состояния отправленной транзакции и обновление баланса и статуса аукциона
      this.setState({
        txBeingSent: null
      })
      await this.updateBalance()
      await this.updateStopped()
    }
  }

  _getRpcErrorMessage(error) {
    if (error.data) {
      return error.data.message
    }

    return error.message
  }

  render() {
    if(!this.state.selectedAccount) {
      return <ConnectWallet
        connectWallet={this._connectWallet}
        networkError={this.state.networkError}
        dismiss={this._dismissNetworkError}
      />
    }

    
    if(this.state.stopped){
      return <p>Auction stopped</p>
    }

    return(
      <>
        {this.state.txBeingSent && (
          <WaitingForTransactionMessage txHash={this.state.txBeingSent}/>
        )}

        {this.state.transactionError && (
          <TransactionErrorMessage
            message={this._getRpcErrorMessage(this.state.transactionError)}
            dismiss={this._dismissTransactionError}
          />
        )}

        {this.state.balance &&
          <p>Your balance: {ethers.utils.formatEther(this.state.balance)} ETH</p>}

          {this.state.currentPrice &&
          <div>
            <p>Current item price: {this.state.currentPrice} ETH</p>
            <button onClick={this.nextBlock}>Next Block</button>
            <button onClick={this.buy}>Buy</button>
            </div>}
      </>
    )
  }
}